/// <reference types="chrome"/>

// We need a mechanism to coordinate messages between the sidepanel/overlay, content script, and the offscreen document
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
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
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
  if ('getContexts' in chrome.runtime) {
    try {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
      });
      return contexts.length > 0;
    } catch {
      // fallback
    }
  }

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
    await new Promise<void>((resolve) => {
      const listener = (message: any) => {
        if (message.type === 'OFFSCREEN_READY') {
          offscreenReady = true;
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(); 
      }, 5000);
    });
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 送信元が同一拡張機能（Content Script / Offscreen）か検証
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  if (message.type === 'OFFSCREEN_READY') {
    offscreenReady = true;
    return false;
  }

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
    return true;
  }

  return false;
});

// Send a message to content script to toggle overlay on action click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const url = tab.url || '';
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    console.warn(`[ruri-webgpu] スクリプト実行が許可されていないページです: ${url}`);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
  } catch {
    // もしContent Scriptがまだ注入されていないページの場合はスクリプトを注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      // 注入後に再度トグル
      setTimeout(async () => {
        try {
          if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' });
        } catch (e) {}
      }, 100);
    } catch (err: any) {
      console.warn('[ruri-webgpu] executeScript 実行スキップ:', err.message);
    }
  }
});
