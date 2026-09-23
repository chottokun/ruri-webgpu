import { initOverlay } from './overlay';

// Execute right away
initOverlay();

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
