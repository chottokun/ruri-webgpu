/**
 * ONNX Runtime Web 埋め込みモデルモジュール
 * WebGPU (優先) または WASM (CPUフォールバック) で推論を実行し、
 * Mean Pooling と L2 正規化を行って 256 次元の正規化埋め込みベクトルを出力します。
 * 参照: chottokun/ruri_with_sentencepiece_lite (dist_assets/ruri_v3_lite.py)
 */

import type * as ort from 'onnxruntime-web';
import { EMBED_DIM, HF_CONFIG, PREFIXES } from '../config';
import { fetchWithCache } from './hf_loader';
import { SpmTokenizer } from './tokenizer';

// ブラウザのグローバル (index.html の CDN script) から ort を安全に取得
function getOrt(): typeof ort {
  const globalOrt = (typeof window !== 'undefined' && (window as any).ort);
  if (!globalOrt) {
    throw new Error('ONNX Runtime Web (ort) が読み込まれていません。CDNスクリプトのロード状態を確認してください。');
  }

  if (!globalOrt.env.wasm.wasmPaths) {
    globalOrt.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
  }

  return globalOrt;
}

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
    // 0. ONNX Runtime Web 環境設定
    const ortInstance = getOrt();
    ortInstance.env.wasm.numThreads = 1;

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
      this.session = await getOrt().InferenceSession.create(modelBuffer, sessionOptions);
    } catch (err) {
      if (this.device === 'webgpu') {
        console.warn('model_fp16.onnx の WebGPU 読み込みに失敗しました。model.onnx (FP32) での WebGPU 実行を試行します:', err);

        const fp32Buffer = await fetchWithCache(
          HF_CONFIG.files.modelFp32,
          (loaded, total, speed) => {
            if (onProgress) {
              onProgress({
                stage: 'downloading_model',
                loadedBytes: loaded,
                totalBytes: total,
                speed,
                message: `FP32 モデルダウンロード中 (${(loaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`,
              });
            }
          }
        );

        try {
          // FP32 モデルで WebGPU 実行を試みる
          this.session = await getOrt().InferenceSession.create(fp32Buffer, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
          });
          console.log('model.onnx (FP32) による WebGPU セッションの作成に成功しました。');
        } catch (webgpuFp32Err) {
          console.warn('WebGPU での実行が利用できません。WASM CPU にフォールバックします:', webgpuFp32Err);
          this.device = 'wasm';
          this.session = await getOrt().InferenceSession.create(fp32Buffer, {
            executionProviders: ['wasm'],
          });
        }
      } else {
        throw err;
      }
    }

    // 5. 推論カーネルのウォームアップ検証 (5秒タイムアウト付き)
    try {
      await Promise.race([
        this.runInference('テスト', false),
        new Promise((_, reject) => setTimeout(() => reject(new Error('WebGPU 推論タイムアウト (5s)')), 5000)),
      ]);
      console.log(`推論カーネルのウォームアップに成功しました (${this.device.toUpperCase()})`);
    } catch (warmupErr) {
      if (this.device === 'webgpu') {
        console.warn('WebGPU 推論カーネルでエラーまたはタイムアウトが発生しました。WASM CPU にフォールバックします:', warmupErr);
        this.device = 'wasm';
        const fp32Buffer = await fetchWithCache(HF_CONFIG.files.modelFp32);
        this.session = await getOrt().InferenceSession.create(fp32Buffer, {
          executionProviders: ['wasm'],
        });
        await this.runInference('テスト', false);
        console.log('WASM CPU での推論確認に成功しました。');
      } else {
        throw warmupErr;
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
   * 内部用推論実行ロジック
   */
  private async runInference(text: string, isQuery: boolean): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('モデルセッションが初期化されていません。');
    }

    const prefix = isQuery ? PREFIXES.query : PREFIXES.doc;
    const tokenized = this.tokenizer.encodeForModel(text, prefix);
    const { inputIds, attentionMask, tokenTypeIds, seqLength } = tokenized;

    const inputNames = new Set(this.session.inputNames);
    const feeds: Record<string, ort.Tensor> = {};
    const Tensor = getOrt().Tensor;

    if (inputNames.has('input_ids')) {
      feeds['input_ids'] = new Tensor('int64', inputIds, [1, seqLength]);
    }
    if (inputNames.has('attention_mask')) {
      feeds['attention_mask'] = new Tensor('int64', attentionMask, [1, seqLength]);
    }
    if (inputNames.has('token_type_ids')) {
      feeds['token_type_ids'] = new Tensor('int64', tokenTypeIds, [1, seqLength]);
    }

    const results = await this.session.run(feeds);
    const outputTensor = results.last_hidden_state || Object.values(results)[0];
    const hiddenData = outputTensor.data as Float32Array;

    const pooled = meanPool(hiddenData, attentionMask, seqLength, EMBED_DIM);
    return l2Normalize(pooled);
  }

  /**
   * 単一テキストの埋め込みベクトルを計算します。
   */
  async embed(text: string, isQuery: boolean = false): Promise<Float32Array> {
    return this.runInference(text, isQuery);
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
