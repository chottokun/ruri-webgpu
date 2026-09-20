/**
 * ベクトル検索における検索対象ドキュメントのインターフェース
 */
export interface DocumentItem {
  id: string;
  title: string;
  text: string;
  category: string;
}

/**
 * 検索結果のインターフェース。ドキュメント情報に類似度スコアを追加
 */
export interface SearchResult extends DocumentItem {
  score: number;
}

/**
 * メモリ上で動作するシンプルなベクトルストア
 * 高速なコサイン類似度計算のため、ベクトルは事前にL2正規化されていることを前提とし、内積を利用して類似度を計算する
 */
export class VectorStore {
  private items: DocumentItem[] = [];
  private vectors: Float32Array[] = [];

  /**
   * ドキュメントとそれに対応するベクトルをストアに追加する
   * @param item ドキュメント情報
   * @param vector ドキュメントの埋め込みベクトル（L2正規化済みであること）
   */
  public add(item: DocumentItem, vector: Float32Array): void {
    this.items.push(item);
    this.vectors.push(vector);
  }

  /**
   * クエリベクトルとストア内の各ベクトルの類似度を計算し、上位の検索結果を返す
   * @param queryVec 検索クエリのベクトル（L2正規化済みであること）
   * @param topK 返却する最大件数（デフォルト: 5）
   * @returns 類似度スコアの降順にソートされた検索結果の配列
   */
  public search(queryVec: Float32Array, topK: number = 5): SearchResult[] {
    const results: SearchResult[] = [];
    const length = this.items.length;
    const dim = queryVec.length;

    for (let i = 0; i < length; i++) {
      const vec = this.vectors[i];
      let score = 0;
      
      // 内積を計算（両方のベクトルがL2正規化されていれば、内積＝コサイン類似度）
      for (let j = 0; j < dim; j++) {
        score += vec[j] * queryVec[j];
      }

      results.push({
        ...this.items[i],
        score
      });
    }

    // スコアの降順にソート
    results.sort((a, b) => b.score - a.score);

    // 指定された件数(topK)だけ返す
    return results.slice(0, topK);
  }

  /**
   * ストア内のすべてのデータをクリアする
   */
  public clear(): void {
    this.items = [];
    this.vectors = [];
  }

  /**
   * ストアに保存されているドキュメントの数を返す
   * @returns ドキュメント数
   */
  public size(): number {
    return this.items.length;
  }

  /**
   * ストアに保存されているすべてのドキュメントを返す
   * @returns ドキュメント情報の配列
   */
  public getDocuments(): DocumentItem[] {
    return [...this.items];
  }
}
