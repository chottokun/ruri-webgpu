import { initOverlay, toggleOverlay } from './overlay';

// Execute right away
initOverlay();

// service_worker (アイコンクリック / commandsショートカット) からの開閉要求をリッスン
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_OVERLAY') {
      toggleOverlay();
    }
  });
}

// インラインハイライト用スタイル
// 1. CSS Custom Highlight API (Chrome 105+ ネイティブ: DOM破壊ゼロでGitHub等のSPAでも100%安定)
// 2. フォールバック用クラススタイル
if (!document.getElementById('ruri-highlight-style')) {
  const style = document.createElement('style');
  style.id = 'ruri-highlight-style';
  style.textContent = `
    /* CSS Custom Highlight API 用セレクタ */
    ::highlight(ruri-match) {
      background-color: rgba(254, 240, 138, 0.85);
      color: #0f172a;
    }
    ::highlight(ruri-match-current) {
      background-color: #6366f1;
      color: #ffffff;
    }

    /* フォールバック用クラス */
    .ruri-match {
      background-color: rgba(254, 240, 138, 0.85) !important;
      color: #0f172a !important;
      border-radius: 3px !important;
      box-shadow: 0 0 0 1px rgba(234, 179, 8, 0.5) !important;
    }
    .ruri-match-current {
      background-color: #6366f1 !important;
      color: #ffffff !important;
      border-radius: 3px !important;
      box-shadow: 0 0 0 2px #4338ca, 0 0 12px rgba(99, 102, 241, 0.7) !important;
      animation: ruri-pulse 1.5s ease-in-out infinite alternate !important;
    }
    @keyframes ruri-pulse {
      from { box-shadow: 0 0 0 2px #4338ca, 0 0 6px rgba(99, 102, 241, 0.5); }
      to { box-shadow: 0 0 0 2px #4338ca, 0 0 14px rgba(99, 102, 241, 0.9); }
    }
  `;
  document.head.appendChild(style);
}
