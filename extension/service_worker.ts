/// <reference types="chrome"/>

// Set up the side panel on extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// We need a mechanism to coordinate messages between the sidepanel, content script, and the offscreen document
let creatingOffscreenDocument: Promise<void> | null = null;
let offscreenReady = false;

// Function to setup the offscreen document
async function setupOffscreenDocument(path: string) {
  if (await hasDocument(path)) {
    return;
  }
  
  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }
  
  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: path,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Running WebGPU for semantic search embeddings',
  });
  
  await creatingOffscreenDocument;
  creatingOffscreenDocument = null;
}

// Reset the offscreen ready state when it's closed by the system
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OFFSCREEN_CLOSED') {
    offscreenReady = false;
  }
});

// Check if offscreen doc exists
async function hasDocument(path: string) {
  // Chrome 116+ では chrome.runtime.getContexts が推奨
  if ('getContexts' in chrome.runtime) {
    try {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
      });
      return contexts.length > 0;
    } catch {
      // 失敗時は clients.matchAll へフォールバック
    }
  }

  // 従来の clients.matchAll フォールバック
  if (typeof (self as any).clients !== 'undefined') {
    const matchedClients = await (self as any).clients.matchAll();
    for (const client of matchedClients) {
      if (client.url.endsWith(path)) {
        return true;
      }
    }
  }
  return false;
}

// Ensure offscreen document is ready before routing messages to it
async function ensureOffscreenReady() {
  if (await hasDocument('offscreen.html')) {
     offscreenReady = true;
     return;
  }
  
  await setupOffscreenDocument('offscreen.html');
  if (!offscreenReady) {
    // Wait for the ready message
    await new Promise<void>((resolve) => {
      const listener = (message: any) => {
        if (message.type === 'OFFSCREEN_READY') {
          offscreenReady = true;
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      // Timeout to avoid hanging forever
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(); // Continue anyway and let errors be handled down the line
      }, 5000);
    });
  }
}

// Listen for messages from sidepanel or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_READY') {
    offscreenReady = true;
    return false; // No async response needed
  }

  // Requests destined for the offscreen document
  if (message.type === 'INIT_MODEL' || message.type === 'EMBED_TEXT') {
    (async () => {
      try {
        await ensureOffscreenReady();
        const response = await chrome.runtime.sendMessage({
          ...message,
          target: 'offscreen'
        });
        sendResponse(response);
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep the message channel open for sendResponse
  }

  // Context menu or other background actions could be handled here
  return false;
});
