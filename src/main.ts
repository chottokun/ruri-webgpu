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

  // 2. 初期バッジ表示
  if (deviceBadge) {
    deviceBadge.textContent = '判定中...';
    deviceBadge.className = 'status-badge mode-wasm';
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

    const searchInputEl = document.getElementById('search-input') as HTMLInputElement | null;

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

    // 7. 収録文書一覧の表示・フィルタ・クリック検索の制御
    setupCorpusViewer(docs, (selectedTitle) => {
      if (searchInputEl) {
        searchInputEl.value = selectedTitle;
        searchInputEl.dispatchEvent(new Event('input', { bubbles: true }));
        searchInputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchInputEl.focus();
      }
    });

  } catch (error) {
    console.error('アプリケーション初期化エラー:', error);
    alert(`初期化中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 収録文書一覧アコーディオンのセットアップ
 */
function setupCorpusViewer(docs: DocumentItem[], onSelect: (title: string) => void): void {
  const toggleBtn = document.getElementById('corpus-toggle-btn');
  const panel = document.getElementById('corpus-panel');
  const filtersContainer = document.getElementById('corpus-filters');
  const gridContainer = document.getElementById('corpus-grid');

  if (!toggleBtn || !panel || !filtersContainer || !gridContainer) return;

  let isOpen = false;
  toggleBtn.addEventListener('click', () => {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.remove('hidden');
      toggleBtn.innerHTML = '<span>🔼 収録文書一覧を閉じる</span>';
    } else {
      panel.classList.add('hidden');
      toggleBtn.innerHTML = '<span>📖 収録文書一覧を見る</span>';
    }
  });

  // ユニークカテゴリの抽出
  const categories = ['すべて', ...Array.from(new Set(docs.map((d) => d.category)))];
  let activeCategory = 'すべて';

  function renderGrid(): void {
    if (!gridContainer) return;
    gridContainer.innerHTML = '';

    const filtered = activeCategory === 'すべて'
      ? docs
      : docs.filter((d) => d.category === activeCategory);

    for (const doc of filtered) {
      const card = document.createElement('div');
      card.className = 'corpus-item-card';
      card.title = 'クリックしてこの文書で検索';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
          <span class="tag-badge" style="margin: 0; font-size: 0.7rem;">${escapeHtml(doc.category)}</span>
        </div>
        <h4 class="corpus-item-title">${escapeHtml(doc.title)}</h4>
        <p class="corpus-item-text">${escapeHtml(doc.text)}</p>
      `;
      card.addEventListener('click', () => {
        onSelect(doc.title);
      });
      gridContainer.appendChild(card);
    }
  }

  // フィルターボタンの描画
  filtersContainer.innerHTML = '';
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className = `filter-btn ${cat === activeCategory ? 'active' : ''}`;
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      activeCategory = cat;
      const allBtns = filtersContainer.querySelectorAll('.filter-btn');
      allBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid();
    });
    filtersContainer.appendChild(btn);
  }

  renderGrid();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
