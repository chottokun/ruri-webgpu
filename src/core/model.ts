/**
 * ONNX Runtime Web 埋め込みモデルモジュール
 * WebGPU (優先) または WASM (CPUフォールバック) で推論を実行し、
 * Mean Pooling と L2 正規化を行って 256 次元の正規化埋め込みベクトルを出力します。
 * 参照: chottokun/ruri_with_sentencepiece_lite (dist_assets/ruri_v3_lite.py)
 */

import * as ort from 'onnxruntime-web';
import { EMBED_DIM, HF_CONFIG, PREFIXES } from '../config';
import { fetchWithCache } from './hf_loader';
import { SpmTokenizer } from './tokenizer';

export interface ModelInitProgress {
  stage: 'downloading_tokenizer' | 'downloading_model' | 'creating_session' | 'ready';
  loadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  message: string;
}

export type ExecutionDevice = 'webgpu' | 'wasm';

export class EmbeddingModel {
  private session: ort.InferenceSession | null = null;
  private tokenizer: SpmTokenizer;
  private device: ExecutionDevice = 'wasm';

  constructor() {
    this.tokenizer = new SpmTokenizer();
  }

  /**
   * 現在のブラウザが WebGPU をサポートしているかを判定します。
   */
  static async checkWebGPUSupport(): Promise<boolean> {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) {
      return false;
    }
    try {
      const adapter = await nav.gpu.requestAdapter();
      return adapter !== null;
    } catch {
      return false;
    }
  }

  /**
   * モデルとトークナイザーを初期化します。
   */
  async init(onProgress?: (progress: ModelInitProgress) => void): Promise<ExecutionDevice> {
    // 1. デバイスの判定
    const hasWebGPU = await EmbeddingModel.checkWebGPUSupport();
    this.device = hasWebGPU ? 'webgpu' : 'wasm';

    // 2. トークナイザーの取得 & 初期化
    if (onProgress) {
      onProgress({
        stage: 'downloading_tokenizer',
        message: 'トークナイザー辞書をダウンロード中...',
      });
    }

    const tokenizerBuffer = await fetchWithCache(
      HF_CONFIG.files.tokenizerModel,
      (loaded, total, speed) => {
        if (onProgress) {
          onProgress({
            stage: 'downloading_tokenizer',
            loadedBytes: loaded,
            totalBytes: total,
            speed,
            message: `トークナイザー辞書取得中 (${(loaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`,
          });
        }
      }
    );

    await this.tokenizer.loadModel(tokenizerBuffer);

    // 3. モデルバイナリの選択と取得
    const modelFilename = this.device === 'webgpu'
      ? HF_CONFIG.files.modelFp16
      : HF_CONFIG.files.modelFp32;

    if (onProgress) {
      onProgress({
        stage: 'downloading_model',
        message: `ONNX モデル (${this.device === 'webgpu' ? 'WebGPU FP16' : 'WASM FP32'}) をダウンロード中...`,
      });
    }

    const modelBuffer = await fetchWithCache(
      modelFilename,
      (loaded, total, speed) => {
        if (onProgress) {
          onProgress({
            stage: 'downloading_model',
            loadedBytes: loaded,
            totalBytes: total,
            speed,
            message: `モデルダウンロード中 (${(loaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`,
          });
        }
      }
    );

    // 4. ONNX Runtime Web セッションの作成
    if (onProgress) {
      onProgress({
        stage: 'creating_session',
        message: `推論セッション (${this.device}) を初期化中...`,
      });
    }

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: this.device === 'webgpu' ? ['webgpu'] : ['wasm'],
      graphOptimizationLevel: 'all',
    };

    try {
      this.session = await ort.InferenceSession.create(modelBuffer, sessionOptions);
    } catch (err) {
      if (this.device === 'webgpu') {
        console.warn('WebGPU での初期化に失敗しました。WASM にフォールバックします:', err);
        this.device = 'wasm';
        const fallbackBuffer = await fetchWithCache(HF_CONFIG.files.modelFp32);
        this.session = await ort.InferenceSession.create(fallbackBuffer, {
          executionProviders: ['wasm'],
        });
      } else {
        throw err;
      }
    }

    if (onProgress) {
      onProgress({
        stage: 'ready',
        message: `準備完了 (${this.device.toUpperCase()})`,
      });
    }

    return this.device;
  }

  /**
   * 単一テキストの埋め込みベクトルを計算します。
   */
  async embed(text: string, isQuery: boolean = false): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('モデルが初期化されていません。先に init() を呼び出してください。');
    }

    const prefix = isQuery ? PREFIXES.query : PREFIXES.doc;
    const tokenized = this.tokenizer.encodeForModel(text, prefix);
    const { inputIds, attentionMask, tokenTypeIds, seqLength } = tokenized;

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', inputIds, [1, seqLength]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLength]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLength]),
    };

    const results = await this.session.run(feeds);
    // last_hidden_state を取得 (形状: [1, seqLength, hiddenDim])
    const outputTensor = results.last_hidden_state || Object.values(results)[0];
    const hiddenData = outputTensor.data as Float32Array;

    // Mean Pooling の実行
    const pooled = meanPool(hiddenData, attentionMask, seqLength, EMBED_DIM);

    // L2 正規化の実行
    return l2Normalize(pooled);
  }

  /**
   * 複数テキストを一括で埋め込みベクトル化します。
   */
  async embedBatch(
    texts: string[],
    isQuery: boolean = false,
    onProgress?: (current: number, total: number) => void
  ): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      const vec = await this.embed(texts[i], isQuery);
      results.push(vec);
      if (onProgress) {
        onProgress(i + 1, texts.length);
      }
    }
    return results;
  }

  getDevice(): ExecutionDevice {
    return this.device;
  }
}

/**
 * Mean Pooling: attention_mask で重み付けしたトークンベクトルの平均を計算
 * 参照: chottokun/ruri_with_sentencepiece_lite (dist_assets/ruri_v3_lite.py)
 */
export function meanPool(
  hiddenState: Float32Array,
  attentionMask: BigInt64Array,
  seqLength: number,
  hiddenDim: number
): Float32Array {
  const result = new Float32Array(hiddenDim);
  let maskSum = 0;

  for (let i = 0; i < seqLength; i++) {
    const maskVal = Number(attentionMask[i]);
    if (maskVal > 0) {
      maskSum += maskVal;
      const offset = i * hiddenDim;
      for (let d = 0; d < hiddenDim; d++) {
        result[d] += hiddenState[offset + d];
      }
    }
  }

  const divisor = Math.max(maskSum, 1e-9);
  for (let d = 0; d < hiddenDim; d++) {
    result[d] /= divisor;
  }

  return result;
}

/**
 * L2 正規化: ベクトル長を 1.0 に正規化
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  const divisor = Math.max(norm, 1e-12);

  const normalized = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    normalized[i] = vec[i] / divisor;
  }
  return normalized;
}
