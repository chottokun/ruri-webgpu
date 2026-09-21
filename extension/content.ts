import { extractAndSplitSentences } from './utils';

// This script is injected into the active tab to extract content

// Execute right away and return basic extracted content
const result = (() => {
    // Basic extraction logic
    const title = document.title;
    const url = window.location.href;
    
    // Attempt to get main content, fallback to body text
    let mainElement = document.querySelector('main') || document.querySelector('article') || document.body;
    
    // Remove unwanted elements like scripts, styles, nav, etc.
    const clone = mainElement.cloneNode(true) as HTMLElement;
    const unwantedSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe'];
    unwantedSelectors.forEach(selector => {
        const elements = clone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });
    
    // Extract text and clean it up
    let text = clone.textContent || '';
    text = text.replace(/\s+/g, ' ').trim();
    
    // Limit text length to avoid huge inputs for embedding
    // ruri-v3 handles up to 512 tokens, we roughly limit to 2000 chars as a heuristic
    if (text.length > 2000) {
        text = text.substring(0, 2000);
    }
    
    return {
        title,
        url,
        text
    };
})();

// Ensure we only add the message listener once
if (!(window as any).ruriListenerAdded) {
    (window as any).ruriListenerAdded = true;

    // Inject CSS for highlighting if not already present
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

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'EXTRACT_SENTENCES') {
            const sentences = extractAndSplitSentences(document);
            sendResponse({ success: true, sentences });
            return true;
        }
        
        if (message.type === 'HIGHLIGHT_SENTENCE') {
            const { sentenceId } = message;
            if (sentenceId) {
                const el = document.querySelector(`[data-ruri-id="${sentenceId}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.remove('ruri-highlighted');
                    // Force reflow to restart animation
                    void (el as HTMLElement).offsetWidth; 
                    el.classList.add('ruri-highlighted');
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Element not found' });
                }
            }
            return true;
        }
        
        return false;
    });
}

// Ensure the result is returned for chrome.scripting.executeScript
result;
