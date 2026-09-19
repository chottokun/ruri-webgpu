/**
 * Hugging Face Hub 通信・Cache API 管理モジュール
 * ブラウザの Cache API を活用してモデルバイナリをローカルに永続化し、
 * ゼロ・バックエンド構成での高速ロードを実現します。
 */

import { HF_CONFIG } from '../config';

export interface ProgressCallback {
  (loaded: number, total: number, speedBytesPerSec: number): void;
}

/**
 * Hugging Face Hub からファイルをストリーミングダウンロードし、
 * Cache API に保存して ArrayBuffer を返します。
 * 既にキャッシュが存在する場合は即座にキャッシュから返却します。
 */
export async function fetchWithCache(
  filename: string,
  onProgress?: ProgressCallback
): Promise<ArrayBuffer> {
  const url = `${HF_CONFIG.baseUrl}/${filename}`;
  const cacheKey = new Request(url);

  // Cache API の確認
  if ('caches' in window) {
    try {
      const cache = await caches.open(HF_CONFIG.cacheName);
      const cachedResponse = await cache.match(cacheKey);

      if (cachedResponse) {
        // キャッシュヒット
        const buffer = await cachedResponse.arrayBuffer();
        if (onProgress) {
          onProgress(buffer.byteLength, buffer.byteLength, 0);
        }
        return buffer;
      }
    } catch (err) {
      console.warn('Cache API の読み込みに失敗しました。ネットワークから直接取得します:', err);
    }
  }

  // ネットワークから取得
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Hugging Face Hub からの取得に失敗しました: ${url} (status: ${response.status})`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

  // ストリーミングダウンロードの処理
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (onProgress) {
      onProgress(buffer.byteLength, buffer.byteLength, 0);
    }
    await storeInCache(cacheKey, response.clone(), buffer);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastTime = performance.now();
  let lastLoaded = 0;
  let currentSpeed = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    loaded += value.byteLength;

    const now = performance.now();
    const elapsedSec = (now - lastTime) / 1000;
    if (elapsedSec >= 0.2) {
      currentSpeed = (loaded - lastLoaded) / elapsedSec;
      lastTime = now;
      lastLoaded = loaded;
      if (onProgress) {
        onProgress(loaded, total || loaded, currentSpeed);
      }
    }
  }

  if (onProgress) {
    onProgress(loaded, total || loaded, currentSpeed);
  }

  // 全チャンクを単一の ArrayBuffer に結合
  const fullBuffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    fullBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Cache API に保存
  await storeInCache(cacheKey, response, fullBuffer.buffer);

  return fullBuffer.buffer;
}

/**
 * Cache API にレスポンスを保存する補助関数
 */
async function storeInCache(
  request: Request,
  originalResponse: Response,
  buffer: ArrayBuffer
): Promise<void> {
  if (!('caches' in window)) return;

  try {
    const cache = await caches.open(HF_CONFIG.cacheName);
    const headers = new Headers(originalResponse.headers);
    headers.set('Content-Length', buffer.byteLength.toString());

    const responseToCache = new Response(buffer, {
      status: 200,
      statusText: 'OK',
      headers,
    });

    await cache.put(request, responseToCache);
  } catch (err) {
    console.warn('Cache API への保存に失敗しました:', err);
  }
}

/**
 * ブラウザのキャッシュをクリアします（デバッグ・再取得用）
 */
export async function clearCache(): Promise<boolean> {
  if (!('caches' in window)) return false;
  return caches.delete(HF_CONFIG.cacheName);
}
