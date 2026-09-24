/**
 * Offscreen Document Script
 * 
 * This script runs in the background (offscreen document) and manages the WebGPU 
 * EmbeddingModel lifecycle and performs embeddings. It listens for messages from the 
 * background service worker.
 */

import { EmbeddingModel } from '../src/core/model';
import type * as ort from 'onnxruntime-web';

// Extension環境では、offscreen.htmlでロードされたローカルortのWASMパスをローカルassetsに事前に設定
const ortInstance = (window as any).ort;
if (ortInstance) {
  if (ortInstance.env) {
    if (!ortInstance.env.wasm) {
      ortInstance.env.wasm = {};
    }
    // 末尾にスラッシュを付与（ortの仕様）
    const baseUrl = chrome.runtime.getURL('assets/ort/');
    ortInstance.env.wasm.wasmPaths = baseUrl;
  }
}


let model: EmbeddingModel | null = null;
let isInitializing = false;
let initPromise: Promise<string> | null = null;

// Send a message that we are ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return false;
  }

  if (message.type === 'INIT_MODEL') {
    (async () => {
      try {
        if (!model) {
          if (!isInitializing) {
            isInitializing = true;
            model = new EmbeddingModel();
            

            
            initPromise = model.init((progress) => {
              chrome.runtime.sendMessage({
                type: 'MODEL_PROGRESS',
                progress
              });
            }).then(device => {
                isInitializing = false;
                return device;
            });
          }
        }
        
        const device = await initPromise;
        sendResponse({ success: true, device });
      } catch (error: any) {
        isInitializing = false;
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // async response
  }

  if (message.type === 'EMBED_TEXT') {
    (async () => {
      try {
        if (!model) {
          throw new Error('モデルが初期化されていません');
        }
        const { text, isQuery } = message;
        
        let embedding: Float32Array;
        if (Array.isArray(text)) {
           embedding = (await model.embedBatch(text, isQuery))[0]; // Handling single text for now but could support batch
        } else {
           embedding = await model.embed(text, isQuery);
        }
        
        // Convert Float32Array to regular array to send over messaging
        sendResponse({ success: true, embedding: Array.from(embedding) });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
