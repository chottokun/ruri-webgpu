// This script is injected into the active tab to extract content

(() => {
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
