/**
 * ruri-webgpu メインエントリーポイント
 * ruri-v3-30m-lite の WebGPU 日本語セマンティック検索デモ
 * すべてのモジュール（推論モデル、ベクトルストア、UI）を統合して実行します。
 */

import { EmbeddingModel } from './core/model';
import { VectorStore, DocumentItem } from './core/vector_store';
import { ProgressUI } from './ui/progress';
import { SearchView } from './ui/search_view';
import sampleDocsData from './data/sample_docs.json';

async function bootstrap(): Promise<void> {
  const deviceBadge = document.getElementById('device-badge');
  const searchSection = document.getElementById('search-section');
  const corpusStats = document.getElementById('corpus-stats');
  const searchLatency = document.getElementById('search-latency');

  // 1. ProgressUI の初期化
  const progressUI = new ProgressUI('progress-container');

  // 2. WebGPU 対応判定とバッジの更新
  const hasWebGPU = await EmbeddingModel.checkWebGPUSupport();
  if (deviceBadge) {
    if (hasWebGPU) {
      deviceBadge.textContent = 'WebGPU (FP16)';
      deviceBadge.className = 'status-badge mode-webgpu';
    } else {
      deviceBadge.textContent = 'WASM CPU (FP32)';
      deviceBadge.className = 'status-badge mode-wasm';
    }
  }

  // 3. 埋め込みモデルの初期化
  const model = new EmbeddingModel();

  try {
    await model.init((progress) => {
      if (progress.stage === 'downloading_tokenizer' || progress.stage === 'downloading_model') {
        progressUI.updateDownloadProgress(
          progress.stage === 'downloading_tokenizer' ? 'tokenizer.model' : 'onnx model',
          progress.loadedBytes || 0,
          progress.totalBytes || 0,
          progress.speed || 0
        );
      }
    });

    // 実際の稼働デバイスでバッジを再更新
    if (deviceBadge) {
      const activeDev = model.getDevice();
      if (activeDev === 'webgpu') {
        deviceBadge.textContent = 'WebGPU 有効';
        deviceBadge.className = 'status-badge mode-webgpu';
      } else {
        deviceBadge.textContent = 'WASM CPU (FP32)';
        deviceBadge.className = 'status-badge mode-wasm';
      }
    }

    // 4. サンプルコーパスのインデックス構築
    const docs = sampleDocsData as DocumentItem[];
    const vectorStore = new VectorStore();

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      // 文書埋め込み（isQuery = false によりプレフィックス「文章: 」が付与される）
      const vector = await model.embed(doc.text, false);
      vectorStore.add(doc, vector);
      progressUI.updateIndexProgress(i + 1, docs.length);
    }

    // 5. 初期化完了と検索UIの活性化
    progressUI.complete('準備完了！検索を開始できます');

    if (searchSection) {
      searchSection.classList.remove('hidden');
    }
    if (corpusStats) {
      corpusStats.textContent = `インデックス文書数: ${vectorStore.size()} 件`;
    }

    // 6. リアルタイム検索UIの接続
    const searchView = new SearchView(
      'search-input',
      'search-results',
      'search-spinner',
      'empty-state'
    );

    searchView.onSearch(async (query: string) => {
      const startTime = performance.now();
      // クエリ埋め込み（isQuery = true によりプレフィックス「検索クエリ: 」が付与される）
      const queryVec = await model.embed(query, true);
      const results = vectorStore.search(queryVec, 10);
      const latencyMs = Math.round(performance.now() - startTime);

      if (searchLatency) {
        searchLatency.textContent = `検索時間: ${latencyMs}ms (${model.getDevice().toUpperCase()})`;
      }

      return results;
    });

  } catch (error) {
    console.error('アプリケーション初期化エラー:', error);
    alert(`初期化中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
