import { extractAndSplitSentences, computeCosineSimilarity, computeHybridScore, ExtractedSentence } from './utils';

let isOverlayOpen = false;
let overlayElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// モデルと検索状態
let modelReady = false;
let modelInitializing = false;
let inPageSentences: (ExtractedSentence & { embedding?: Float32Array })[] = [];
const embeddingCache = new Map<string, Float32Array>();
let currentSearchAbortId = 0;
let currentIndex = -1;
let matchedResults: {
  id: string;
  text: string;
  score: number;
  semanticSimilarity: number;
  keywordMatched: boolean;
  ranges?: Range[];
}[] = [];

// DOM Elements inside ShadowRoot
let findInput: HTMLInputElement;
let countBadge: HTMLElement;
let prevBtn: HTMLButtonElement;
let nextBtn: HTMLButtonElement;
let closeBtn: HTMLButtonElement;
let dropdown: HTMLElement;
let statusBanner: HTMLElement;

/**
 * 拡張機能コンテキストが有効か判定
 */
function isExtensionValid(): boolean {
  try {
    return !!(typeof chrome !== 'undefined' && chrome?.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/**
 * 安全な sendMessage ラッパー
 */
async function safeSendMessage(message: any): Promise<any> {
  if (!isExtensionValid()) {
    throw new Error('拡張機能が更新されました。ページ(F5)を再読み込みしてください。');
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err: any) {
    if (err?.message?.includes('Extension context invalidated')) {
      throw new Error('拡張機能が更新されました。ページ(F5)を再読み込みしてください。');
    }
    throw err;
  }
}

export function initOverlay() {
  // 古いオーバーレイ要素がDOMに残っていれば全削除（拡張機能リロード時の重複・残存防止）
  const oldElements = document.querySelectorAll('#ruri-overlay-root');
  oldElements.forEach(el => el.remove());

  // GitHub (Turbo / PJAX) や SPA のページ遷移イベントを監視してDOM同期
  const handlePageNavigation = () => {
    inPageSentences = [];
    if (isOverlayOpen) {
      preparePageSentences(true);
      if (findInput && findInput.value.trim()) {
        startStreamSearch(findInput.value.trim());
      }
    }
  };
  window.addEventListener('popstate', handlePageNavigation);
  document.addEventListener('turbo:render', handlePageNavigation);
  document.addEventListener('turbo:load', handlePageNavigation);

  // キャプチャフェーズ (true) で最優先でキーイベントを捕捉し、ブラウザのネイティブCtrl+Fをインターセプト
  window.addEventListener('keydown', (e) => {
    // Ctrl+F / Cmd+F または Ctrl+K / Cmd+K でスマートページ内検索バーを起動
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F' || e.key === 'k' || e.key === 'K')) {
      if (!e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleOverlay(true);
      }
    }
    // Esc で閉じる
    if (e.key === 'Escape' && isOverlayOpen) {
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay(false);
    }
  }, true);
}

export function toggleOverlay(force?: boolean) {
  isOverlayOpen = force !== undefined ? force : !isOverlayOpen;

  if (isOverlayOpen) {
    if (!overlayElement || !document.body.contains(overlayElement)) {
      createOverlay();
    }
    overlayElement!.classList.remove('hidden');
    setTimeout(() => {
      findInput?.focus();
      findInput?.select();
    }, 40);

    // ページ内文章の抽出＆Range取得（SPA/GitHubでページ内容が動的変更されている場合にも即追従）
    preparePageSentences(true);

    // バックグラウンドでモデル初期化
    if (!modelReady && !modelInitializing) {
      initModel();
    }
  } else {
    if (overlayElement) {
      overlayElement.classList.add('hidden');
    }
    // 検索バーを閉じたときはハイライトを解除
    clearAllHighlights();
  }
}

function createOverlay() {
  // 念のため再チェックして既存をクリーンアップ
  const existing = document.getElementById('ruri-overlay-root');
  if (existing) existing.remove();

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
  container.className = 'ruri-find-container';

  container.innerHTML = `
    <div class="ruri-find-bar">
      <div class="ruri-find-logo" title="ruri: WebGPU 意味検索">
        <span class="ruri-logo-text">ruri</span>
      </div>
      <div class="ruri-find-input-wrapper">
        <input 
          type="text" 
          id="ruri-find-input" 
          placeholder="意味でページ内検索..." 
          autocomplete="off" 
          spellcheck="false"
        />
      </div>
      <div class="ruri-find-count" id="ruri-find-count">-/-</div>
      <div class="ruri-find-actions">
        <button class="ruri-find-btn" id="ruri-prev-btn" title="前へ (Shift+Enter)">▲</button>
        <button class="ruri-find-btn" id="ruri-next-btn" title="次へ (Enter)">▼</button>
        <button class="ruri-find-btn" id="ruri-close-btn" title="閉じる (Esc)">✕</button>
      </div>
    </div>
    <div class="ruri-status-banner hidden" id="ruri-status-banner"></div>
    <div class="ruri-find-dropdown hidden" id="ruri-find-dropdown"></div>
  `;

  shadowRoot.appendChild(linkEl);
  shadowRoot.appendChild(container);
  document.body.appendChild(overlayElement);

  // 要素バインド
  findInput = shadowRoot.getElementById('ruri-find-input') as HTMLInputElement;
  countBadge = shadowRoot.getElementById('ruri-find-count') as HTMLElement;
  prevBtn = shadowRoot.getElementById('ruri-prev-btn') as HTMLButtonElement;
  nextBtn = shadowRoot.getElementById('ruri-next-btn') as HTMLButtonElement;
  closeBtn = shadowRoot.getElementById('ruri-close-btn') as HTMLButtonElement;
  dropdown = shadowRoot.getElementById('ruri-find-dropdown') as HTMLElement;
  statusBanner = shadowRoot.getElementById('ruri-status-banner') as HTMLElement;

  // イベントハンドラ
  closeBtn.addEventListener('click', () => toggleOverlay(false));
  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));

  let debounceTimer: any;
  findInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      startStreamSearch(findInput.value.trim());
    }, 180);
  });

  // Enter / Shift+Enter での移動
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigate(-1);
      } else {
        navigate(1);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigate(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
    }
  });
}

function showStatus(message: string, isError = false) {
  if (!statusBanner) return;
  if (!message) {
    statusBanner.classList.add('hidden');
    return;
  }
  statusBanner.classList.remove('hidden');
  statusBanner.innerHTML = message;
  statusBanner.style.color = isError ? '#f87171' : '#94a3b8';
}

function preparePageSentences(force = false) {
  if (force || inPageSentences.length === 0) {
    const extracted = extractAndSplitSentences(document);
    inPageSentences = extracted.map(s => {
      const cached = embeddingCache.get(s.text);
      return {
        ...s,
        embedding: cached
      };
    });
  }
}

async function initModel() {
  if (modelReady || modelInitializing) return;
  modelInitializing = true;
  try {
    showStatus('<span class="ruri-spinner"></span> WebGPU モデル初期化中...');
    const response = await safeSendMessage({ type: 'INIT_MODEL' });
    if (response && response.success) {
      modelReady = true;
      showStatus('');
      if (findInput && findInput.value.trim()) {
        startStreamSearch(findInput.value.trim());
      }
    } else {
      showStatus(`エラー: ${response?.error || '初期化失敗'}`, true);
    }
  } catch (err: any) {
    showStatus(`⚠️ ${err.message}`, true);
  } finally {
    modelInitializing = false;
  }
}

async function embedText(text: string, isQuery = false): Promise<Float32Array> {
  const response = await safeSendMessage({ type: 'EMBED_TEXT', text, isQuery });
  if (response && response.success && response.embedding) {
    return new Float32Array(response.embedding);
  }
  throw new Error(response?.error || '埋め込み計算に失敗しました');
}

/**
 * ページ内ストリーム検索 (--hybrid 準拠)
 */
async function startStreamSearch(query: string) {
  const searchId = ++currentSearchAbortId;

  if (!query) {
    matchedResults = [];
    currentIndex = -1;
    updateCountUI();
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    showStatus('');
    clearAllHighlights();
    return;
  }

  if (!modelReady) {
    showStatus('<span class="ruri-spinner"></span> モデル準備待機中...');
    await initModel();
    if (!modelReady || searchId !== currentSearchAbortId) return;
  }

  showStatus('<span class="ruri-spinner"></span> クエリをベクトル化中...');

  let queryEmbedding: Float32Array;
  try {
    queryEmbedding = await embedText(query, true);
  } catch (err: any) {
    showStatus(`⚠️ ${err.message}`, true);
    return;
  }

  if (searchId !== currentSearchAbortId) return;

  // 1. キャッシュ済み文で即座にハイブリッド判定
  const uncomputedIndices: number[] = [];
  const currentScored: typeof matchedResults = [];

  for (let i = 0; i < inPageSentences.length; i++) {
    const item = inPageSentences[i];
    if (item.embedding) {
      const sim = computeCosineSimilarity(queryEmbedding, item.embedding);
      const hybrid = computeHybridScore(sim, item.text, query, true);
      // 類似度 >= 0.65 または キーワード一致
      if (hybrid.matched || hybrid.score >= 0.65) {
        currentScored.push({
          id: item.id,
          text: item.text,
          score: hybrid.score,
          semanticSimilarity: sim,
          keywordMatched: hybrid.matched,
          ranges: item.ranges
        });
      }
    } else {
      uncomputedIndices.push(i);
    }
  }

  currentScored.sort((a, b) => b.score - a.score);
  matchedResults = currentScored;
  currentIndex = matchedResults.length > 0 ? 0 : -1;
  updateCountUI();
  renderDropdown();
  updateInlineHighlights();

  // 最初のマッチに自動ジャンプ
  if (currentIndex >= 0) {
    jumpToCurrentMatch();
  }

  if (uncomputedIndices.length === 0) {
    showStatus('');
    return;
  }

  // 2. 未計算の文をストリーミング（逐次）で計算しリアルタイム更新
  let processed = inPageSentences.length - uncomputedIndices.length;

  for (const idx of uncomputedIndices) {
    if (searchId !== currentSearchAbortId || !isOverlayOpen) break;

    const item = inPageSentences[idx];
    showStatus(`<span class="ruri-spinner"></span> 解析中: ${processed + 1}/${inPageSentences.length} 文`);

    try {
      const emb = await embedText(item.text, false);
      item.embedding = emb;
      embeddingCache.set(item.text, emb);
      processed++;

      const sim = computeCosineSimilarity(queryEmbedding, emb);
      const hybrid = computeHybridScore(sim, item.text, query, true);

      if (hybrid.matched || hybrid.score >= 0.65) {
        matchedResults.push({
          id: item.id,
          text: item.text,
          score: hybrid.score,
          semanticSimilarity: sim,
          keywordMatched: hybrid.matched,
          ranges: item.ranges
        });
        matchedResults.sort((a, b) => b.score - a.score);

        if (currentIndex === -1 && matchedResults.length > 0) {
          currentIndex = 0;
          jumpToCurrentMatch();
        }
        updateCountUI();
        renderDropdown();
        updateInlineHighlights();
      }
    } catch (e) {
      console.warn('Sentence embedding failed:', e);
    }
  }

  if (searchId === currentSearchAbortId) {
    showStatus('');
  }
}

function updateCountUI() {
  if (matchedResults.length === 0) {
    countBadge.innerText = '0/0';
    countBadge.style.color = '#94a3b8';
  } else {
    countBadge.innerText = `${currentIndex + 1}/${matchedResults.length}`;
    countBadge.style.color = '#818cf8';
  }
}

function navigate(direction: number) {
  if (matchedResults.length === 0) return;
  currentIndex = (currentIndex + direction + matchedResults.length) % matchedResults.length;
  updateCountUI();
  renderDropdown();
  jumpToCurrentMatch();
}

/**
 * ページ上の全ハイライト（CSS Custom Highlight API / DOM class）を解除
 */
function clearAllHighlights() {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS && (CSS as any).highlights) {
    try {
      (CSS as any).highlights.delete('ruri-match');
      (CSS as any).highlights.delete('ruri-match-current');
    } catch (e) {
      console.warn('Failed to clear CSS highlights:', e);
    }
  }
  const matches = document.querySelectorAll('.ruri-match, .ruri-match-current');
  matches.forEach(el => {
    el.classList.remove('ruri-match', 'ruri-match-current');
  });
}

/**
 * マッチした文すべてをページ上でインラインハイライト（Ctrl+F仕様）
 * CSS Custom Highlight API (Chrome 105+) を使用して、DOMを1ミリも破壊せずGPU描画
 */
function updateInlineHighlights() {
  clearAllHighlights();
  if (matchedResults.length === 0) return;

  const supportsHighlightAPI =
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    (CSS as any).highlights &&
    typeof (window as any).Highlight !== 'undefined';

  if (supportsHighlightAPI) {
    try {
      const matchRanges: Range[] = [];
      const currentRanges: Range[] = [];

      matchedResults.forEach((item, idx) => {
        if (!item.ranges || item.ranges.length === 0) return;
        if (idx === currentIndex) {
          currentRanges.push(...item.ranges);
        } else {
          matchRanges.push(...item.ranges);
        }
      });

      if (matchRanges.length > 0) {
        (CSS as any).highlights.set('ruri-match', new (window as any).Highlight(...matchRanges));
      }
      if (currentRanges.length > 0) {
        (CSS as any).highlights.set('ruri-match-current', new (window as any).Highlight(...currentRanges));
      }
      return;
    } catch (e) {
      console.warn('CSS Highlight API failed, falling back to class-based highlighting:', e);
    }
  }

  // フォールバック: DOM class 方式
  matchedResults.forEach((item, idx) => {
    const isCurrent = idx === currentIndex;
    const elements = document.querySelectorAll(`[data-ruri-id="${item.id}"]`);
    elements.forEach(el => {
      el.classList.add(isCurrent ? 'ruri-match-current' : 'ruri-match');
    });
  });
}

/**
 * カレントのマッチ文へ自動スクロール＆強調
 */
function jumpToCurrentMatch() {
  if (currentIndex < 0 || currentIndex >= matchedResults.length) return;
  const match = matchedResults[currentIndex];

  if (match.ranges && match.ranges.length > 0) {
    const firstRange = match.ranges[0];
    const targetEl = firstRange.startContainer.parentElement;
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    const el = document.querySelector(`[data-ruri-id="${match.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  updateInlineHighlights();
}

function renderDropdown() {
  if (matchedResults.length === 0) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.classList.remove('hidden');
  dropdown.innerHTML = '';

  matchedResults.slice(0, 8).forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = `ruri-find-row ${idx === currentIndex ? 'active' : ''}`;
    
    const badge = item.keywordMatched ? '<span class="ruri-hybrid-tag">一致</span>' : '';
    
    row.innerHTML = `
      <div class="ruri-find-row-text">${escapeHtml(item.text)}</div>
      <div class="ruri-find-row-meta">
        ${badge}
        <span class="ruri-find-row-score">${item.score.toFixed(2)}</span>
      </div>
    `;

    row.addEventListener('click', () => {
      currentIndex = idx;
      updateCountUI();
      renderDropdown();
      jumpToCurrentMatch();
    });

    dropdown.appendChild(row);
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
