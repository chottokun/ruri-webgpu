/**
 * ダウンロードおよびインデックス構築の進捗を表示・管理するUIクラス
 */
export class ProgressUI {
  private container: HTMLElement;
  private titleElement: HTMLElement;
  private statsElement: HTMLElement;
  private barFillElement: HTMLElement;
  private isCompleted: boolean = false;

  /**
   * @param containerId プログレスバーを表示するコンテナのID
   */
  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`Progress container with id '${containerId}' not found.`);
    }
    this.container = el;

    // 内部DOMの構築
    this.container.innerHTML = `
      <div class="progress-header">
        <span class="progress-title">待機中...</span>
        <span class="progress-stats">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill"></div>
      </div>
    `;

    this.titleElement = this.container.querySelector('.progress-title') as HTMLElement;
    this.statsElement = this.container.querySelector('.progress-stats') as HTMLElement;
    this.barFillElement = this.container.querySelector('.progress-bar-fill') as HTMLElement;
  }

  /**
   * モデルや辞書のダウンロード進捗を更新する
   * @param filename ダウンロード中のファイル名
   * @param loadedBytes 取得済みバイト数
   * @param totalBytes 合計バイト数
   * @param speedBytesPerSec 転送速度 (バイト/秒)
   */
  public updateDownloadProgress(
    filename: string,
    loadedBytes: number,
    totalBytes: number,
    speedBytesPerSec: number
  ): void {
    if (this.isCompleted) return;

    const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const percent = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
    const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(1);

    this.titleElement.textContent = `ダウンロード中: ${filename}`;
    this.statsElement.textContent = `${loadedMB}MB / ${totalMB}MB (${percent}%) - ${speedMBps} MB/s`;
    this.barFillElement.style.width = `${percent}%`;
  }

  /**
   * インデックス構築の進捗を更新する
   * @param current 現在処理済みの件数
   * @param total 全体の件数
   */
  public updateIndexProgress(current: number, total: number): void {
    if (this.isCompleted) return;

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    
    this.titleElement.textContent = `インデックス構築中...`;
    this.statsElement.textContent = `${current} / ${total} 件 (${percent}%)`;
    this.barFillElement.style.width = `${percent}%`;
  }

  /**
   * 処理完了時にUIを更新し、フェードアウトさせる
   * @param message 完了メッセージ (例: "準備完了")
   */
  public complete(message: string = '準備完了！'): void {
    this.isCompleted = true;
    
    this.titleElement.textContent = message;
    this.statsElement.textContent = '100%';
    this.barFillElement.style.width = '100%';
    
    // サクセス表示の追加
    const successMsg = document.createElement('div');
    successMsg.className = 'success-message';
    successMsg.textContent = message;
    this.container.appendChild(successMsg);

    // フェードアウト
    setTimeout(() => {
      this.container.classList.add('fade-out');
      // 完全に消えた後にDOMツリーから削除するか非表示にする
      setTimeout(() => {
        this.container.classList.add('hidden');
      }, 500);
    }, 1500);
  }
}
