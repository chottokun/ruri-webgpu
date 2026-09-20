export interface SearchResult {
  title: string;
  category: string;
  text: string;
  score: number; // コサイン類似度 (-1.0 ~ 1.0)
}

export type SearchCallback = (query: string) => Promise<SearchResult[]>;

/**
 * 検索UIを管理するクラス
 */
export class SearchView {
  private inputElement: HTMLInputElement;
  private resultsContainer: HTMLElement;
  private spinnerElement: HTMLElement;
  private emptyStateElement: HTMLElement;
  private searchCallback: SearchCallback | null = null;
  private debounceTimer: number | null = null;

  /**
   * @param inputId 検索入力欄のID
   * @param resultsId 検索結果表示コンテナのID
   * @param spinnerId スピナー(ローディング)表示要素のID
   * @param emptyStateId 0件時の表示要素のID
   */
  constructor(
    inputId: string,
    resultsId: string,
    spinnerId: string,
    emptyStateId: string
  ) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    const spinner = document.getElementById(spinnerId);
    const emptyState = document.getElementById(emptyStateId);

    if (!input || !(input instanceof HTMLInputElement)) {
      throw new Error(`Search input with id '${inputId}' not found or is not an input element.`);
    }
    if (!results) throw new Error(`Results container with id '${resultsId}' not found.`);
    if (!spinner) throw new Error(`Spinner element with id '${spinnerId}' not found.`);
    if (!emptyState) throw new Error(`Empty state element with id '${emptyStateId}' not found.`);

    this.inputElement = input;
    this.resultsContainer = results;
    this.spinnerElement = spinner;
    this.emptyStateElement = emptyState;

    this.initEvents();
  }

  /**
   * 検索実行時のコールバックを設定する
   * @param callback 検索クエリを受け取り、SearchResultの配列を返すPromise関数
   */
  public onSearch(callback: SearchCallback): void {
    this.searchCallback = callback;
  }

  private initEvents(): void {
    this.inputElement.addEventListener('input', () => {
      const query = this.inputElement.value.trim();
      
      // デバウンス処理 (150ms)
      if (this.debounceTimer !== null) {
        window.clearTimeout(this.debounceTimer);
      }

      if (query.length === 0) {
        this.clearResults();
        return;
      }

      this.debounceTimer = window.setTimeout(() => {
        this.performSearch(query);
      }, 150);
    });
  }

  private async performSearch(query: string): Promise<void> {
    if (!this.searchCallback) return;

    this.showSpinner();
    this.hideEmptyState();
    this.resultsContainer.innerHTML = '';

    try {
      const results = await this.searchCallback(query);
      this.renderResults(results);
    } catch (error) {
      console.error('Search failed:', error);
      // エラー処理（必要に応じてUIに表示）
    } finally {
      this.hideSpinner();
    }
  }

  /**
   * 検索結果をレンダリングする
   * @param results SearchResultの配列
   */
  private renderResults(results: SearchResult[]): void {
    this.resultsContainer.innerHTML = '';

    if (results.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    results.forEach(result => {
      const card = document.createElement('div');
      card.className = 'result-card glass-panel';

      const scoreVal = result.score.toFixed(3);

      card.innerHTML = `
        <div class="result-header">
          <h3 class="result-title">${this.escapeHtml(result.title)}</h3>
          <span class="score-badge">類似度スコア: ${scoreVal}</span>
        </div>
        <div>
          <span class="tag-badge">${this.escapeHtml(result.category)}</span>
        </div>
        <p class="result-text">${this.escapeHtml(result.text)}</p>
      `;

      this.resultsContainer.appendChild(card);
    });
  }

  private clearResults(): void {
    this.resultsContainer.innerHTML = '';
    this.hideEmptyState();
  }

  private showSpinner(): void {
    this.spinnerElement.classList.remove('hidden');
  }

  private hideSpinner(): void {
    this.spinnerElement.classList.add('hidden');
  }

  private showEmptyState(): void {
    this.emptyStateElement.classList.remove('hidden');
  }

  private hideEmptyState(): void {
    this.emptyStateElement.classList.add('hidden');
  }

  /**
   * XSS対策用HTMLエスケープ処理
   * @param str エスケープ対象の文字列
   * @returns エスケープ後の文字列
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
