import { extractAndSplitSentences, computeCosineSimilarity, computeHybridScore, ExtractedSentence } from './utils';
import { StorageManager } from './storage';

const storage = new StorageManager();

let isOverlayOpen = false;
let overlayElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

// State
let modelReady = false;
let currentMode: 'global' | 'inpage' = 'global';
let analysisInProgress = false;
let inPageSentences: (ExtractedSentence & { embedding?: Float32Array })[] = [];

// DOM Elements inside shadow root
let searchInput: HTMLInputElement;
let resultsContainer: HTMLElement;
let modeGlobalBtn: HTMLElement;
let modeInpageBtn: HTMLElement;
let actionBtn: HTMLButtonElement;
let statusText: HTMLElement;
let closeBtn: HTMLElement;

export function initOverlay() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      toggleOverlay();
    }
    if (e.key === 'Escape' && isOverlayOpen) {
      toggleOverlay(false);
    }
  });
}

function toggleOverlay(force?: boolean) {
  isOverlayOpen = force !== undefined ? force : !isOverlayOpen;
  
  if (isOverlayOpen) {
    if (!overlayElement) {
      createOverlay();
    }
    overlayElement!.classList.remove('hidden');
    setTimeout(() => searchInput?.focus(), 50);
    if (!modelReady) {
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
  
  // Inject CSS directly into shadow root
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = chrome.runtime.getURL('assets/overlay.css');
  
  const container = document.createElement('div');
  container.className = 'ruri-overlay-container';
  
  container.innerHTML = `
    <div class="ruri-overlay-header">
      <h1>ruri</h1>
      <div class="ruri-overlay-search-box">
        <input type="text" id="ruri-search" placeholder="意味で検索..." autocomplete="off" />
      </div>
      <button class="ruri-overlay-close" id="ruri-close">✕</button>
    </div>
    <div class="ruri-overlay-controls">
      <div class="ruri-overlay-mode-toggle">
        <button id="ruri-mode-global" class="ruri-overlay-mode-btn active">全体</button>
        <button id="ruri-mode-inpage" class="ruri-overlay-mode-btn">ページ内</button>
      </div>
      <button id="ruri-action-btn" class="ruri-overlay-btn">現在のページをインデックス</button>
      <div class="ruri-overlay-status" id="ruri-status">準備中...</div>
    </div>
    <div class="ruri-overlay-results" id="ruri-results">
    </div>
  `;
  
  shadowRoot.appendChild(linkEl);
  shadowRoot.appendChild(container);
  document.body.appendChild(overlayElement);
  
  // Bind elements
  searchInput = shadowRoot.getElementById('ruri-search') as HTMLInputElement;
  resultsContainer = shadowRoot.getElementById('ruri-results') as HTMLElement;
  modeGlobalBtn = shadowRoot.getElementById('ruri-mode-global') as HTMLElement;
  modeInpageBtn = shadowRoot.getElementById('ruri-mode-inpage') as HTMLElement;
  actionBtn = shadowRoot.getElementById('ruri-action-btn') as HTMLButtonElement;
  statusText = shadowRoot.getElementById('ruri-status') as HTMLElement;
  closeBtn = shadowRoot.getElementById('ruri-close') as HTMLElement;
  
  // Events
  closeBtn.addEventListener('click', () => toggleOverlay(false));
  
  modeGlobalBtn.addEventListener('click', () => setMode('global'));
  modeInpageBtn.addEventListener('click', () => setMode('inpage'));
  
  actionBtn.addEventListener('click', () => {
    if (currentMode === 'global') {
      indexCurrentPage();
    } else {
      analyzePage();
    }
  });
  
  let searchTimeout: any;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(searchInput.value);
    }, 300);
  });
}

function setMode(mode: 'global' | 'inpage') {
  currentMode = mode;
  if (mode === 'global') {
    modeGlobalBtn.classList.add('active');
    modeInpageBtn.classList.remove('active');
    actionBtn.innerText = '現在のページをインデックス';
  } else {
    modeGlobalBtn.classList.remove('active');
    modeInpageBtn.classList.add('active');
    actionBtn.innerText = 'ページ内の文を解析';
  }
  if (searchInput.value) {
    performSearch(searchInput.value);
  }
}

async function initModel() {
  try {
    statusText.innerHTML = '<span class="ruri-overlay-spinner"></span> モデル初期化中...';
    const response = await chrome.runtime.sendMessage({ type: 'INIT_MODEL' });
    if (response && response.success) {
      modelReady = true;
      statusText.innerText = '準備完了';
      updateIndexCount();
    } else {
      statusText.innerText = 'エラー: ' + (response?.error || '不明');
    }
  } catch (err: any) {
    statusText.innerText = 'エラー: ' + err.message;
  }
}

async function updateIndexCount() {
  if (currentMode === 'global') {
    const count = await storage.getArticleCount();
    statusText.innerText = `インデックス数: ${count}`;
  }
}

async function embedText(text: string): Promise<Float32Array> {
  const response = await chrome.runtime.sendMessage({ type: 'EMBED_TEXT', text });
  if (response && response.success && response.embedding) {
    return new Float32Array(response.embedding);
  }
  throw new Error(response?.error || 'Failed to embed text');
}

async function indexCurrentPage() {
  try {
    actionBtn.disabled = true;
    actionBtn.innerText = '抽出中...';
    
    // Extract page text directly since we are in the content script
    let mainElement = document.querySelector('main') || document.querySelector('article') || document.body;
    const clone = mainElement.cloneNode(true) as HTMLElement;
    const unwantedSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe'];
    unwantedSelectors.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    let text = clone.textContent || '';
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 2000) text = text.substring(0, 2000);
    
    actionBtn.innerText = '埋め込み生成中...';
    const embedding = await embedText(text);
    
    await storage.saveArticle({
      id: window.location.href,
      url: window.location.href,
      title: document.title,
      text: text,
      embedding: embedding
    });
    
    updateIndexCount();
    actionBtn.innerText = 'インデックス完了';
    setTimeout(() => {
      actionBtn.disabled = false;
      actionBtn.innerText = '現在のページをインデックス';
    }, 2000);
  } catch (err: any) {
    alert(`エラー: ${err.message}`);
    actionBtn.disabled = false;
    actionBtn.innerText = '現在のページをインデックス';
  }
}

async function analyzePage() {
  try {
    if (analysisInProgress) return;
    analysisInProgress = true;
    actionBtn.disabled = true;
    inPageSentences = [];
    
    statusText.innerText = '文を抽出中...';
    const extracted = extractAndSplitSentences(document);
    inPageSentences = extracted.map(s => ({ ...s }));
    
    statusText.innerText = `抽出された文: ${extracted.length}`;
    
    for (let i = 0; i < inPageSentences.length; i++) {
      if (!analysisInProgress || !isOverlayOpen) break;
      
      statusText.innerText = `埋め込み生成中... (${i + 1}/${inPageSentences.length})`;
      const embedding = await embedText(inPageSentences[i].text);
      inPageSentences[i].embedding = embedding;
      
      if (searchInput.value.trim() && i % 5 === 0) {
        performSearch(searchInput.value);
      }
    }
    
    statusText.innerText = '解析完了';
    if (searchInput.value.trim()) {
      performSearch(searchInput.value);
    }
    
    setTimeout(() => {
      actionBtn.disabled = false;
      actionBtn.innerText = '再解析する';
      analysisInProgress = false;
    }, 2000);
    
  } catch (err: any) {
    alert(`エラー: ${err.message}`);
    analysisInProgress = false;
    actionBtn.disabled = false;
  }
}

async function performSearch(query: string) {
  if (!query.trim()) {
    resultsContainer.innerHTML = '';
    return;
  }
  
  if (!modelReady) return;
  
  try {
    statusText.innerHTML = '<span class="ruri-overlay-spinner"></span> 検索中...';
    const queryEmbedding = await embedText(query);
    const isHybrid = true; // Hardcoded true for now, can add toggle later
    
    let results: any[] = [];
    
    if (currentMode === 'global') {
      const articles = await storage.getAllArticles();
      results = articles.map(article => {
        const similarity = computeCosineSimilarity(queryEmbedding, article.embedding);
        const titleMatch = computeHybridScore(similarity, article.title || '', query, isHybrid);
        const textMatch = computeHybridScore(similarity, article.text || '', query, isHybrid);
        
        let finalScore = similarity;
        let keywordMatched = false;
        let matchTarget: 'title' | 'text' | undefined = undefined;

        if (titleMatch.matched) {
          finalScore = titleMatch.score;
          keywordMatched = true;
          matchTarget = 'title';
        } else if (textMatch.matched) {
          finalScore = textMatch.score;
          keywordMatched = true;
          matchTarget = 'text';
        }

        return {
          id: article.url,
          title: article.title,
          url: article.url,
          score: finalScore,
          semanticSimilarity: similarity,
          keywordMatched,
          matchTarget,
          isInPage: false
        };
      });
    } else {
      results = inPageSentences
        .filter(sent => sent.embedding)
        .map(sent => {
          const similarity = computeCosineSimilarity(queryEmbedding, sent.embedding!);
          const match = computeHybridScore(similarity, sent.text, query, isHybrid);
          return {
            id: sent.id,
            title: sent.text,
            url: '',
            score: match.score,
            semanticSimilarity: similarity,
            keywordMatched: match.matched,
            matchTarget: 'text',
            isInPage: true
          };
        });
    }
    
    results.sort((a, b) => b.score - a.score);
    displayResults(results.slice(0, 10));
    updateIndexCount();
    
  } catch (err: any) {
    console.error(err);
    resultsContainer.innerHTML = `<div style="color: #ef4444">エラー: ${escapeHtmlStr(err.message)}</div>`;
  }
}

function escapeHtmlStr(unsafe: string) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function displayResults(results: any[]) {
  if (results.length === 0) {
    resultsContainer.innerHTML = '<div style="color:#94a3b8; text-align:center; padding: 20px;">該当なし</div>';
    return;
  }
  
  resultsContainer.innerHTML = '';
  for (const item of results) {
    const card = document.createElement('div');
    card.className = 'ruri-overlay-result-card';

    const boostBadge = item.keywordMatched
      ? `<span class="ruri-overlay-hybrid-badge">一致 +0.25 (${item.matchTarget === 'title' ? 'タイトル' : '本文'})</span>`
      : '';

    if (item.isInPage) {
      card.innerHTML = `
        <div class="ruri-overlay-result-title">${escapeHtmlStr(item.title)}</div>
        <div class="ruri-overlay-result-score">
          スコア: ${item.score.toFixed(4)}
          <span style="color: #64748b; font-size: 0.75rem; margin-left: 6px;">(類似度: ${item.semanticSimilarity.toFixed(4)})</span>
          ${boostBadge}
        </div>
      `;
      card.addEventListener('click', () => {
        const el = document.querySelector(`[data-ruri-id="${item.id}"]`);
        if (el) {
          toggleOverlay(false);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('ruri-highlighted');
          void (el as HTMLElement).offsetWidth; 
          el.classList.add('ruri-highlighted');
        }
      });
    } else {
      card.innerHTML = `
        <div class="ruri-overlay-result-title">${escapeHtmlStr(item.title)}</div>
        <div class="ruri-overlay-result-url">${escapeHtmlStr(item.url)}</div>
        <div class="ruri-overlay-result-score">
          スコア: ${item.score.toFixed(4)}
          <span style="color: #64748b; font-size: 0.75rem; margin-left: 6px;">(類似度: ${item.semanticSimilarity.toFixed(4)})</span>
          ${boostBadge}
        </div>
      `;
      card.addEventListener('click', () => {
        window.open(item.id, '_blank');
      });
    }
    
    resultsContainer.appendChild(card);
  }
}
