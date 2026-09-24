import { extractAndSplitSentences, computeCosineSimilarity, computeHybridScore, ExtractedSentence } from './utils';

let isOverlayOpen = false;
let overlayElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// モデルとページ内解析の状態管理
let modelReady = false;
let modelInitializing = false;
let inPageSentences: (ExtractedSentence & { embedding?: Float32Array })[] = [];
let currentSearchAbortId = 0;
let selectedResultIndex = 0;
let currentResults: {
  id: string;
  text: string;
  score: number;
  semanticSimilarity: number;
  keywordMatched: boolean;
  matchTarget: 'title' | 'text';
}[] = [];

// ShadowRoot 内の DOM 要素
let searchInput: HTMLInputElement;
let resultsContainer: HTMLElement;
let statusText: HTMLElement;
let closeBtn: HTMLElement;

export function initOverlay() {
  document.addEventListener('keydown', (e) => {
    // Cmd+K または Ctrl+K でオーバーレイをトグル
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggleOverlay();
    }
    // Esc で閉じる
    if (e.key === 'Escape' && isOverlayOpen) {
      e.preventDefault();
      toggleOverlay(false);
    }
  });
}

export function toggleOverlay(force?: boolean) {
  isOverlayOpen = force !== undefined ? force : !isOverlayOpen;

  if (isOverlayOpen) {
    if (!overlayElement) {
      createOverlay();
    }
    overlayElement!.classList.remove('hidden');
    setTimeout(() => {
      searchInput?.focus();
      searchInput?.select();
    }, 50);

    // ページ内の文章抽出とマーキング準備（未抽出の場合）
    preparePageSentences();

    // モデルが未準備の場合はバックグラウンド初期化
    if (!modelReady && !modelInitializing) {
      initModel();
    }
  } else {
    if (overlayElement) {
      overlayElement.classList.add('hidden');
    }
  }
}

function createOverlay() {
  overlayElement = document.createElement('div');
  overlayElement.id = 'ruri-overlay-root';
  overlayElement.className = 'hidden';

  shadowRoot = overlayElement.attachShadow({ mode: 'open' });

  // CSS の注入
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  try {
    linkEl.href = chrome?.runtime?.getURL ? chrome.runtime.getURL('assets/overlay.css') : '';
  } catch {
    linkEl.href = '';
  }

  const container = document.createElement('div');
  container.className = 'ruri-overlay-container';

  container.innerHTML = `
    <div class="ruri-overlay-header">
      <div class="ruri-overlay-logo">
        <h1>ruri</h1>
        <span class="ruri-badge">WebGPU</span>
      </div>
      <div class="ruri-overlay-search-box">
        <input 
          type="text" 
          id="ruri-search" 
          placeholder="ページ内を意味でストリーム検索 (Enterで移動)..." 
          autocomplete="off" 
          spellcheck="false"
        />
      </div>
      <button class="ruri-overlay-close" id="ruri-close" title="閉じる (Esc)">✕</button>
    </div>
    <div class="ruri-overlay-controls">
      <div class="ruri-overlay-status" id="ruri-status">準備中...</div>
      <div class="ruri-overlay-hints">
        <span><kbd>↑</kbd><kbd>↓</kbd> 選択</span>
        <span><kbd>Enter</kbd> 移動 &amp; マーク</span>
        <span><kbd>Esc</kbd> 閉じる</span>
      </div>
    </div>
    <div class="ruri-overlay-results" id="ruri-results">
      <div class="ruri-overlay-empty">キーワードや探したい文脈を入力してください</div>
    </div>
  `;

  shadowRoot.appendChild(linkEl);
  shadowRoot.appendChild(container);
  document.body.appendChild(overlayElement);

  // 要素バインド
  searchInput = shadowRoot.getElementById('ruri-search') as HTMLInputElement;
  resultsContainer = shadowRoot.getElementById('ruri-results') as HTMLElement;
  statusText = shadowRoot.getElementById('ruri-status') as HTMLElement;
  closeBtn = shadowRoot.getElementById('ruri-close') as HTMLElement;

  // イベントリスナー
  closeBtn.addEventListener('click', () => toggleOverlay(false));

  let debounceTimer: any;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      startStreamSearch(searchInput.value.trim());
    }, 200);
  });

  // キーボードナビゲーション（Enter / 矢印キー）
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentResults.length > 0) {
        selectedResultIndex = (selectedResultIndex + 1) % currentResults.length;
        updateSelectedCard();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentResults.length > 0) {
        selectedResultIndex = (selectedResultIndex - 1 + currentResults.length) % currentResults.length;
        updateSelectedCard();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentResults.length > 0 && currentResults[selectedResultIndex]) {
        jumpAndHighlight(currentResults[selectedResultIndex].id);
      }
    }
  });
}

/**
 * ページ内の文章を抽出して DOM に data-ruri-id を付与（マーキング準備）
 */
function preparePageSentences() {
  if (inPageSentences.length === 0) {
    const extracted = extractAndSplitSentences(document);
    inPageSentences = extracted.map(s => ({ ...s }));
    if (statusText) {
      statusText.innerText = `${inPageSentences.length} 文を検出`;
    }
  }
}

/**
 * モデル初期化
 */
async function initModel() {
  if (modelReady || modelInitializing) return;
  modelInitializing = true;
  try {
    statusText.innerHTML = '<span class="ruri-overlay-spinner"></span> WebGPU モデル初期化中...';
    const response = await chrome.runtime.sendMessage({ type: 'INIT_MODEL' });
    if (response && response.success) {
      modelReady = true;
      statusText.innerText = `準備完了 (${inPageSentences.length} 文)`;
      // すでに検索欄に入力があれば検索を開始
      if (searchInput && searchInput.value.trim()) {
        startStreamSearch(searchInput.value.trim());
      }
    } else {
      statusText.innerText = `エラー: ${response?.error || '初期化失敗'}`;
    }
  } catch (err: any) {
    statusText.innerText = `エラー: ${err.message}`;
  } finally {
    modelInitializing = false;
  }
}

/**
 * テキスト埋め込み API 呼び出し
 */
async function embedText(text: string, isQuery = false): Promise<Float32Array> {
  const response = await chrome.runtime.sendMessage({ type: 'EMBED_TEXT', text, isQuery });
  if (response && response.success && response.embedding) {
    return new Float32Array(response.embedding);
  }
  throw new Error(response?.error || 'テキスト埋め込みの生成に失敗しました');
}

/**
 * ストリーミングセマンティック検索 (--hybrid 準拠)
 */
async function startStreamSearch(query: string) {
  const searchId = ++currentSearchAbortId;

  if (!query) {
    currentResults = [];
    resultsContainer.innerHTML = '<div class="ruri-overlay-empty">キーワードや探したい文脈を入力してください</div>';
    statusText.innerText = `準備完了 (${inPageSentences.length} 文)`;
    return;
  }

  if (!modelReady) {
    statusText.innerHTML = '<span class="ruri-overlay-spinner"></span> モデル初期化を待機中...';
    await initModel();
    if (!modelReady || searchId !== currentSearchAbortId) return;
  }

  statusText.innerHTML = '<span class="ruri-overlay-spinner"></span> クエリをエンコード中...';
  
  let queryEmbedding: Float32Array;
  try {
    queryEmbedding = await embedText(query, true);
  } catch (err: any) {
    statusText.innerText = `エラー: ${err.message}`;
    return;
  }

  if (searchId !== currentSearchAbortId) return;

  // 1. すでに埋め込み計算済みの文章について即座にハイブリッドスコアを計算して初回表示
  const scoredList: typeof currentResults = [];
  const uncomputedIndices: number[] = [];

  for (let i = 0; i < inPageSentences.length; i++) {
    const item = inPageSentences[i];
    if (item.embedding) {
      const sim = computeCosineSimilarity(queryEmbedding, item.embedding);
      const hybrid = computeHybridScore(sim, item.text, query, true); // --hybrid
      scoredList.push({
        id: item.id,
        text: item.text,
        score: hybrid.score,
        semanticSimilarity: sim,
        keywordMatched: hybrid.matched,
        matchTarget: 'text'
      });
    } else {
      uncomputedIndices.push(i);
    }
  }

  scoredList.sort((a, b) => b.score - a.score);
  currentResults = scoredList;
  selectedResultIndex = 0;
  renderResults();

  if (uncomputedIndices.length === 0) {
    statusText.innerText = `検索完了 (${currentResults.length} 件一致)`;
    return;
  }

  // 2. 未計算の文をストリーミング（逐次）でエンコードし、リアルタイムにスコア上位を更新
  let computedCount = inPageSentences.length - uncomputedIndices.length;

  for (const idx of uncomputedIndices) {
    if (searchId !== currentSearchAbortId || !isOverlayOpen) break;

    const item = inPageSentences[idx];
    statusText.innerHTML = `<span class="ruri-overlay-spinner"></span> ストリーム解析中: ${computedCount + 1}/${inPageSentences.length} 文`;

    try {
      const emb = await embedText(item.text, false);
      item.embedding = emb;
      computedCount++;

      const sim = computeCosineSimilarity(queryEmbedding, emb);
      const hybrid = computeHybridScore(sim, item.text, query, true); // --hybrid

      currentResults.push({
        id: item.id,
        text: item.text,
        score: hybrid.score,
        semanticSimilarity: sim,
        keywordMatched: hybrid.matched,
        matchTarget: 'text'
      });

      // スコア降順ソートして上位を再描画
      currentResults.sort((a, b) => b.score - a.score);
      renderResults();
    } catch (e) {
      console.warn('Embedding failed for sentence:', item.text, e);
    }
  }

  if (searchId === currentSearchAbortId) {
    statusText.innerText = `解析完了 (上位 ${Math.min(currentResults.length, 10)} 件表示中)`;
  }
}

/**
 * 検索結果一覧を描画
 */
function renderResults() {
  if (currentResults.length === 0) {
    resultsContainer.innerHTML = '<div class="ruri-overlay-empty">該当する文章が見つかりませんでした</div>';
    return;
  }

  resultsContainer.innerHTML = '';
  const topResults = currentResults.slice(0, 15);

  topResults.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `ruri-overlay-result-card ${index === selectedResultIndex ? 'selected' : ''}`;
    card.dataset.index = String(index);

    const boostBadge = item.keywordMatched
      ? `<span class="ruri-overlay-hybrid-badge">キーワード一致 (+0.25)</span>`
      : '';

    card.innerHTML = `
      <div class="ruri-overlay-result-title">${escapeHtml(item.text)}</div>
      <div class="ruri-overlay-result-meta">
        <span class="ruri-score">スコア: ${item.score.toFixed(3)}</span>
        <span class="ruri-similarity">(コサイン類似度: ${item.semanticSimilarity.toFixed(3)})</span>
        ${boostBadge}
      </div>
    `;

    card.addEventListener('click', () => {
      selectedResultIndex = index;
      updateSelectedCard();
      jumpAndHighlight(item.id);
    });

    resultsContainer.appendChild(card);
  });
}

function updateSelectedCard() {
  const cards = resultsContainer.querySelectorAll('.ruri-overlay-result-card');
  cards.forEach((c, idx) => {
    if (idx === selectedResultIndex) {
      c.classList.add('selected');
      c.scrollIntoView({ block: 'nearest' });
    } else {
      c.classList.remove('selected');
    }
  });
}

/**
 * 該当箇所へジャンプ＆インラインハイライト
 */
function jumpAndHighlight(id: string) {
  const targetEl = document.querySelector(`[data-ruri-id="${id}"]`);
  if (targetEl) {
    toggleOverlay(false);
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // アニメーションを確実に再発火させる
    targetEl.classList.remove('ruri-highlighted');
    void (targetEl as HTMLElement).offsetWidth;
    targetEl.classList.add('ruri-highlighted');
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
