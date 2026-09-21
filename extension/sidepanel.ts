import { StorageManager } from './storage';
import { computeCosineSimilarity, computeHybridScore, ExtractedSentence } from './utils';

const storage = new StorageManager();

let isModelReady = false;
let currentMode: 'global' | 'inpage' = 'global';
let inPageSentences: { id: string, text: string, embedding?: Float32Array }[] = [];
let queryEmbeddingCache: { query: string, embedding: Float32Array } | null = null;
let analysisInProgress = false;

// DOM Elements
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

// Mode Toggle Elements
const modeGlobalBtn = document.getElementById('mode-global')!;
const modeInpageBtn = document.getElementById('mode-inpage')!;
const globalSection = document.getElementById('global-section')!;
const inpageSection = document.getElementById('inpage-section')!;

// In-Page Elements
const analyzePageBtn = document.getElementById('analyze-page') as HTMLButtonElement;
const inpageCountEl = document.getElementById('inpage-count')!;
const analyzeProgress = document.getElementById('analyze-progress')!;
const analyzeProgressText = document.getElementById('analyze-progress-text')!;

// Mode toggling
modeGlobalBtn.addEventListener('click', () => {
    currentMode = 'global';
    modeGlobalBtn.classList.add('active');
    modeInpageBtn.classList.remove('active');
    globalSection.classList.add('active');
    inpageSection.classList.remove('active');
    performSearch(searchInput.value);
});

modeInpageBtn.addEventListener('click', () => {
    currentMode = 'inpage';
    modeInpageBtn.classList.add('active');
    modeGlobalBtn.classList.remove('active');
    inpageSection.classList.add('active');
    globalSection.classList.remove('active');
    performSearch(searchInput.value);
});

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

interface SearchResultItem {
  id: string; // url or sentenceId
  title: string;
  url: string;
  score: number;
  semanticSimilarity: number;
  keywordMatched: boolean;
  matchTarget?: 'title' | 'text';
  isInPage?: boolean;
}

async function performSearch(query: string) {
    if (!query.trim()) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    searchSpinner.classList.remove('hidden');
    
    try {
        const start = performance.now();
        
        let queryEmbedding: Float32Array;
        if (queryEmbeddingCache && queryEmbeddingCache.query === query) {
            queryEmbedding = queryEmbeddingCache.embedding;
        } else {
            queryEmbedding = await embedText(query, true);
            queryEmbeddingCache = { query, embedding: queryEmbedding };
        }
        
        const embedLatency = performance.now() - start;
        const searchStart = performance.now();
        const isHybrid = hybridCheckbox ? hybridCheckbox.checked : true;
        
        let results: SearchResultItem[] = [];

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
                    matchTarget
                };
            });
        } else {
            // In-page mode
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
                        matchTarget: 'text' as const,
                        isInPage: true
                    };
                });
        }
        
        results.sort((a, b) => b.score - a.score);
        
        const searchLatency = performance.now() - searchStart;
        latencyStatsEl.innerText = `埋め込み: ${embedLatency.toFixed(0)}ms / 検索: ${searchLatency.toFixed(0)}ms`;
        
        displayResults(results.slice(0, 10)); // Top 10
    } catch (err: any) {
        console.error(err);
        resultsContainer.innerHTML = `<div style="color: var(--error)">エラー: ${err.message}</div>`;
    } finally {
        if (!analysisInProgress) { // Keep spinner if streaming analysis is happening
            searchSpinner.classList.add('hidden');
        }
    }
}

function displayResults(results: SearchResultItem[]) {
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div>該当なし</div>';
        return;
    }
    
    resultsContainer.innerHTML = '';
    for (const item of results) {
        const card = document.createElement('div');
        card.className = 'result-card';

        const boostBadge = item.keywordMatched
            ? `<span class="hybrid-badge">一致 +0.25 (${item.matchTarget === 'title' ? 'タイトル' : '本文'})</span>`
            : '';

        if (item.isInPage) {
            card.innerHTML = `
                <div class="result-title" style="white-space: normal; line-height: 1.4;">${escapeHtml(item.title)}</div>
                <div class="result-score">
                    スコア: ${item.score.toFixed(4)}
                    <span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 6px;">(類似度: ${item.semanticSimilarity.toFixed(4)})</span>
                    ${boostBadge}
                </div>
            `;
            card.addEventListener('click', async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.id) {
                    chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_SENTENCE', sentenceId: item.id });
                }
            });
        } else {
            card.innerHTML = `
                <div class="result-title">${escapeHtml(item.title)}</div>
                <div class="result-url">${escapeHtml(item.url)}</div>
                <div class="result-score">
                    スコア: ${item.score.toFixed(4)}
                    <span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 6px;">(類似度: ${item.semanticSimilarity.toFixed(4)})</span>
                    ${boostBadge}
                </div>
            `;
            card.addEventListener('click', () => {
                chrome.tabs.create({ url: item.id });
            });
        }
        
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

// Global Indexing
indexBtn.addEventListener('click', async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || !tab.url) return;
        
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

// In-Page Analysis
analyzePageBtn.addEventListener('click', async () => {
    try {
        if (analysisInProgress) return;
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id || !tab.url) return;
        
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
            alert('このページは解析できません。');
            return;
        }

        analysisInProgress = true;
        analyzePageBtn.disabled = true;
        analyzeProgress.classList.remove('hidden');
        searchSpinner.classList.remove('hidden');
        inPageSentences = [];
        
        // Ensure content script is injected
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        
        // Request extraction
        analyzeProgressText.innerText = '文を抽出中...';
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_SENTENCES' });
        
        if (!response || !response.success || !response.sentences) {
            throw new Error('文の抽出に失敗しました');
        }
        
        const extracted: ExtractedSentence[] = response.sentences;
        inpageCountEl.innerText = `抽出された文: ${extracted.length}`;
        inPageSentences = extracted.map(s => ({ ...s }));
        
        // Stream embeddings
        let embeddedCount = 0;
        
        for (let i = 0; i < inPageSentences.length; i++) {
            if (!analysisInProgress) break; // Allow cancellation if needed
            
            analyzeProgressText.innerText = `埋め込み生成中... (${i + 1}/${inPageSentences.length})`;
            
            // Generate embedding
            const embedding = await embedText(inPageSentences[i].text, false);
            inPageSentences[i].embedding = embedding;
            embeddedCount++;
            
            // If user has a query, update results periodically
            if (searchInput.value.trim() && i % 5 === 0) {
                performSearch(searchInput.value);
            }
        }
        
        analyzeProgressText.innerText = '解析完了';
        
        // Final search update
        if (searchInput.value.trim()) {
            performSearch(searchInput.value);
        }
        
        setTimeout(() => {
            analyzeProgress.classList.add('hidden');
            analyzePageBtn.disabled = false;
            analyzePageBtn.innerText = '再解析する';
            analysisInProgress = false;
            searchSpinner.classList.add('hidden');
        }, 2000);
        
    } catch (err: any) {
        console.error(err);
        alert(`エラー: ${err.message}`);
        analysisInProgress = false;
        analyzePageBtn.disabled = false;
        analyzeProgress.classList.add('hidden');
        searchSpinner.classList.add('hidden');
    }
});

// Start initialization
initModel();
