import { StorageManager } from './storage';

const storage = new StorageManager();

let isModelReady = false;

const statusBadge = document.getElementById('status-badge')!;
const progressContainer = document.getElementById('progress-container')!;
const appContent = document.getElementById('app-content')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const indexCountEl = document.getElementById('index-count')!;
const latencyStatsEl = document.getElementById('latency-stats')!;
const resultsContainer = document.getElementById('results-container')!;
const searchSpinner = document.getElementById('search-spinner')!;
const indexBtn = document.getElementById('index-current-page') as HTMLButtonElement;
const hybridCheckbox = document.getElementById('hybrid-checkbox') as HTMLInputElement | null;

// ハイブリッド検索トグルの切り替え時に再検索を実行
if (hybridCheckbox) {
  hybridCheckbox.addEventListener('change', () => {
    performSearch(searchInput.value);
  });
}

// Listen for progress from the background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'MODEL_PROGRESS') {
    const { stage, message: msg, loadedBytes, totalBytes } = message.progress;
    
    let text = msg;
    if (loadedBytes && totalBytes) {
       text += ` (${(loadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`;
    }
    progressContainer.innerText = text;
    
    if (stage === 'ready') {
       isModelReady = true;
       setTimeout(() => {
          progressContainer.classList.add('hidden');
          appContent.classList.remove('hidden');
       }, 1000);
    }
  }
});

// Initialize model via background worker
async function initModel() {
  statusBadge.innerText = '初期化リクエスト中...';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'INIT_MODEL' });
    if (response && response.success) {
      statusBadge.innerText = `準備完了 (${response.device})`;
      statusBadge.classList.add('ready');
      isModelReady = true;
      progressContainer.classList.add('hidden');
      appContent.classList.remove('hidden');
      updateIndexCount();
    } else {
      throw new Error(response?.error || '初期化に失敗しました');
    }
  } catch (err: any) {
    statusBadge.innerText = 'エラー';
    progressContainer.innerText = `初期化エラー: ${err.message}`;
    console.error(err);
  }
}

async function updateIndexCount() {
    const count = await storage.getArticleCount();
    indexCountEl.innerText = `インデックス数: ${count}`;
}

async function embedText(text: string, isQuery: boolean = false): Promise<Float32Array> {
   const response = await chrome.runtime.sendMessage({
       type: 'EMBED_TEXT',
       text,
       isQuery
   });
   
   if (!response || !response.success) {
       throw new Error(response?.error || '埋め込み生成に失敗しました');
   }
   
   return new Float32Array(response.embedding);
}

// Compute cosine similarity between two unit vectors
function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

interface SearchResultItem {
  article: any;
  score: number;
  semanticSimilarity: number;
  keywordMatched: boolean;
  matchTarget?: 'title' | 'text';
}

async function performSearch(query: string) {
    if (!query.trim()) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    searchSpinner.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    
    try {
        const start = performance.now();
        const queryEmbedding = await embedText(query, true);
        const embedLatency = performance.now() - start;
        
        const articles = await storage.getAllArticles();
        
        const searchStart = performance.now();
        const isHybrid = hybridCheckbox ? hybridCheckbox.checked : true;
        const searchPattern = query.trim().toLowerCase();

        const results: SearchResultItem[] = articles.map(article => {
            const similarity = cosineSimilarity(queryEmbedding, article.embedding);
            let finalScore = similarity;
            let keywordMatched = false;
            let matchTarget: 'title' | 'text' | undefined = undefined;

            // local-ai-grep 仕様: --hybrid によるキーワード完全・部分一致スコアブースト
            if (isHybrid && searchPattern.length > 0) {
                const titleLower = (article.title || '').toLowerCase();
                const textLower = (article.text || '').toLowerCase();

                if (titleLower.includes(searchPattern)) {
                    finalScore += 0.25; // タイトル一致ボーナス
                    keywordMatched = true;
                    matchTarget = 'title';
                } else if (textLower.includes(searchPattern)) {
                    finalScore += 0.25; // 本文一致ボーナス (local-ai-grep準拠で0.25)
                    keywordMatched = true;
                    matchTarget = 'text';
                }
            }

            return {
                article,
                score: finalScore,
                semanticSimilarity: similarity,
                keywordMatched,
                matchTarget
            };
        });
        
        results.sort((a, b) => b.score - a.score);
        
        const searchLatency = performance.now() - searchStart;
        latencyStatsEl.innerText = `埋め込み: ${embedLatency.toFixed(0)}ms / 検索: ${searchLatency.toFixed(0)}ms`;
        
        displayResults(results.slice(0, 10)); // Top 10
    } catch (err: any) {
        console.error(err);
        resultsContainer.innerHTML = `<div style="color: var(--error)">エラー: ${err.message}</div>`;
    } finally {
        searchSpinner.classList.add('hidden');
    }
}

function displayResults(results: SearchResultItem[]) {
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div>該当なし</div>';
        return;
    }
    
    resultsContainer.innerHTML = '';
    for (const { article, score, semanticSimilarity, keywordMatched, matchTarget } of results) {
        const card = document.createElement('div');
        card.className = 'result-card';

        const boostBadge = keywordMatched
            ? `<span class="hybrid-badge">一致 +0.25 (${matchTarget === 'title' ? 'タイトル' : '本文'})</span>`
            : '';

        card.innerHTML = `
            <div class="result-title">${escapeHtml(article.title)}</div>
            <div class="result-url">${escapeHtml(article.url)}</div>
            <div class="result-score">
                スコア: ${score.toFixed(4)}
                <span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 6px;">(類似度: ${semanticSimilarity.toFixed(4)})</span>
                ${boostBadge}
            </div>
        `;
        card.addEventListener('click', () => {
            chrome.tabs.create({ url: article.url });
        });
        resultsContainer.appendChild(card);
    }
}

function escapeHtml(unsafe: string) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

let searchTimeout: any;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch(searchInput.value);
    }, 300);
});

indexBtn.addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || !tab.url) return;
        
        // Ignore restricted URLs
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
            alert('このページはインデックスできません。');
            return;
        }

        indexBtn.disabled = true;
        indexBtn.innerText = '抽出中...';

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        
        if (!results || !results[0] || !results[0].result) {
            throw new Error('ページのコンテンツを取得できませんでした');
        }
        
        const contentData = results[0].result;
        
        indexBtn.innerText = '埋め込み生成中...';
        const embedding = await embedText(contentData.text, false);
        
        await storage.saveArticle({
            id: contentData.url,
            url: contentData.url,
            title: contentData.title,
            text: contentData.text,
            embedding: embedding
        });
        
        updateIndexCount();
        indexBtn.innerText = 'インデックス完了';
        setTimeout(() => {
            indexBtn.disabled = false;
            indexBtn.innerText = '現在のページをインデックス';
        }, 2000);
        
    } catch (err: any) {
        console.error(err);
        alert(`エラー: ${err.message}`);
        indexBtn.disabled = false;
        indexBtn.innerText = '現在のページをインデックス';
    }
});

// Start initialization
initModel();
