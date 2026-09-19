/**
 * ruri-webgpu メインエントリーポイント
 * ruri-v3-30m-lite の WebGPU 日本語セマンティック検索デモ
 */

import { EmbeddingModel } from './core/model';

// 後ほど Jules の成果物を取り込んだ際に完全結合
console.log('ruri-webgpu 初期化スクリプト読み込み完了');

async function bootstrap() {
  const deviceBadge = document.getElementById('device-badge');
  const initSection = document.getElementById('init-section');
  const initStatusText = document.getElementById('init-status-text');
  const initProgressBar = document.getElementById('init-progress-bar');
  const initPercent = document.getElementById('init-percent');
  const initMeta = document.getElementById('init-meta');

  // 1. WebGPU 対応判定
  const hasWebGPU = await EmbeddingModel.checkWebGPUSupport();
  if (deviceBadge) {
    if (hasWebGPU) {
      deviceBadge.textContent = 'WebGPU (FP16)';
      deviceBadge.className = 'badge badge-webgpu';
    } else {
      deviceBadge.textContent = 'WASM CPU (FP32)';
      deviceBadge.className = 'badge badge-wasm';
    }
  }

  // 2. モデル初期化インスタンスの作成
  const model = new EmbeddingModel();

  try {
    await model.init((progress) => {
      if (initStatusText) {
        initStatusText.textContent = progress.message;
      }
      if (progress.loadedBytes && progress.totalBytes && initProgressBar && initPercent) {
        const pct = Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100));
        initProgressBar.style.width = `${pct}%`;
        initPercent.textContent = `${pct}%`;
      }
      if (progress.speed && initMeta) {
        const speedMB = (progress.speed / 1024 / 1024).toFixed(1);
        initMeta.textContent = `${speedMB} MB/s`;
      }
    });

    console.log('モデル初期化完了。デバイス:', model.getDevice());
    if (initSection) {
      initSection.classList.add('init-complete');
    }
  } catch (error) {
    console.error('初期化エラー:', error);
    if (initStatusText) {
      initStatusText.textContent = `初期化エラー: ${error instanceof Error ? error.message : String(error)}`;
      initStatusText.style.color = '#ef4444';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
