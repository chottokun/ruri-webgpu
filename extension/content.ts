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

// Also keep the highlight animation CSS
if (!document.getElementById('ruri-highlight-style')) {
  const style = document.createElement('style');
  style.id = 'ruri-highlight-style';
  style.textContent = `
    @keyframes ruri-highlight-fade {
      0% { background-color: rgba(99, 102, 241, 0.6); }
      100% { background-color: transparent; }
    }
    .ruri-highlighted {
      animation: ruri-highlight-fade 3s ease-out;
      border-radius: 2px;
      padding: 0 2px;
    }
  `;
  document.head.appendChild(style);
}
