/**
 * Offscreen Document Script
 * 
 * This script runs in the background (offscreen document) and manages the WebGPU 
 * EmbeddingModel lifecycle and performs embeddings. It listens for messages from the 
 * background service worker.
 */

import { EmbeddingModel } from '../src/core/model';
import type * as ort from 'onnxruntime-web';
// Chrome MV3動的import回避: JSEPモジュールをバンドル内にインライン化（静的インポート）
// @ts-ignore
import ortWasmThreaded from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs';

// グローバルスコープに静的ロードされたファクトリ関数を事前バインド
(globalThis as any).__ortWasmThreaded = ortWasmThreaded;
(window as any).__ortWasmThreaded = ortWasmThreaded;

// Extension環境では、offscreen.htmlでロードされたローカルortのWASMパスおよびスレッド設定を事前に適用
const ortInstance = (window as any).ort;
if (ortInstance) {
  if (ortInstance.env) {
    if (!ortInstance.env.wasm) {
      ortInstance.env.wasm = {};
    }
    // Chrome拡張機能環境ではSharedArrayBufferが無効なため、シングルスレッドで動作させる
    ortInstance.env.wasm.numThreads = 1;
    // 相対パス形式およびオブジェクト形式でWASM/MJSアセットのパスを明示指定
    // (chrome-extension://完全修飾URLの動的importエラー対策)
    ortInstance.env.wasm.wasmPaths = {
      'ort-wasm-simd-threaded.jsep.wasm': './assets/ort/ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd-threaded.jsep.mjs': './assets/ort/ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd.wasm': './assets/ort/ort-wasm-simd.wasm',
      'ort-wasm-simd.mjs': './assets/ort/ort-wasm-simd.mjs',
      'ort-wasm.wasm': './assets/ort/ort-wasm.wasm',
      'ort-wasm.mjs': './assets/ort/ort-wasm.mjs',
      mjs: './assets/ort/ort-wasm-simd-threaded.jsep.mjs',
      wasm: './assets/ort/ort-wasm-simd-threaded.jsep.wasm',
    };
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
