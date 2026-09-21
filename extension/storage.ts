/**
 * IndexedDB を利用したストレージモジュール
 */

export interface Article {
  id: string; // URL等
  url: string;
  title: string;
  text: string;
  embedding: Float32Array; // 256-dim ベクトル
  timestamp?: number;
}

const DB_NAME = 'RuriExtensionDB';
const STORE_NAME = 'articles';
const DB_VERSION = 1;

export class StorageManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async saveArticle(article: Article): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      article.timestamp = Date.now();
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(article);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getArticleCount(): Promise<number> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllArticles(): Promise<Article[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
