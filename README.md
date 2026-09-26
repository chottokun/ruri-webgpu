# ruri-webgpu

WebGPU と小型日本語埋め込みモデル（ruri-v3-30m-lite）を用いた完全クライアントサイド意味検索の技術検証リポジトリ

## リポジトリ概要

本リポジトリは、Hugging Face Hub 上の [Chottokun/ruri-v3-30m-lite](https://huggingface.co/Chottokun/ruri-v3-30m-lite) を利用し、バックエンドサーバーを介さずに WebGPU による完全クライアントサイドでの日本語セマンティック検索を検証するためのプロジェクトです。

同一の推論コア（ruri-v3-30m-lite + ONNX Runtime Web + Pure JS Tokenizer）を共有する「2つの実装形態」を提供しています。

---

## 実装形態 1: Web デモ (GitHub Pages)

### 概要
ブラウザ上で対話的に検索・埋め込み計算・トークナイズの挙動を検証できる静的 Web アプリケーションです。インデックス生成やセマンティック検索の動作を確認できます。

### 実行・ビルド
```bash
# 依存関係のインストール
npm install

# Webアプリ開発サーバーの起動
npm run dev

# Webアプリ プロダクションビルド
npm run build
```

---

## 実装形態 2: Chrome 拡張機能 (Manifest V3)

### 概要
閲覧中の Web ページ内でインライン意味検索および文章のハイライトを行う Chrome 拡張機能です。ページ内のテキストを抽出し、オンメモリで推論と検索を行います。

### キー操作
- **起動**: `Ctrl+F` / `Cmd+F` (標準検索のインターセプト), `Ctrl+Shift+F` / `Cmd+Shift+F` (拡張機能公式), または `Ctrl+K` / `Cmd+K` (代替)
- **ナビゲーション**: `Enter` または `Shift+Enter` (次/前の一致箇所へ移動)
- **ハイライト切替**: `Alt+H`
- **終了**: `Esc`

### ビルド・導入
```bash
# Chrome 拡張機能のビルド (出力先: dist-extension/)
npm run build:extension

# Chrome 拡張機能のビルド＆ZIP化 (出力: ruri-webgpu-chrome-extension.zip)
npm run zip:extension
```
ビルド完了後、Chrome の `chrome://extensions/` 画面にて「デベロッパー モード」を有効化し、「パッケージ化されていない拡張機能を読み込む」から `dist-extension/` フォルダを選択して導入します。

---

## 共通技術仕様・アーキテクチャ

- **モデル**: Chottokun/ruri-v3-30m-lite
  - WebGPU 対応環境では ONNX FP16 モデル (`model_fp16.onnx`) を使用
  - 非対応環境では WASM CPU へフォールバック
- **トークナイザー**: Pure JS Tokenizer
  - `@huggingface/tokenizers` を用い、`tokenizer.json` を純粋な JavaScript としてパース（Manifest V3 の `unsafe-eval` 制約への対応）
- **キャッシュ**: Cache API
  - モデルや語彙データをブラウザの Cache API に永続化し、初回以降のロード時間を短縮

---

## 開発コマンド一覧

```bash
# 依存関係のインストール
npm install

# Webアプリ開発サーバーの起動
npm run dev

# Webアプリ プロダクションビルド
npm run build

# テストの実行
npm run test

# Chrome 拡張機能のビルド (出力先: dist-extension/)
npm run build:extension

# Chrome 拡張機能のビルド＆ZIP化 (出力: ruri-webgpu-chrome-extension.zip)
npm run zip:extension
```

---

## 技術ドキュメント一覧

- [Chrome 拡張機能仕様・利用ガイド](docs/EXTENSION.md)
- [日本語特化トークナイザーにおける英字クエリの挙動と対策](docs/tokenizer_insights.md)
- [Vite における ONNX Runtime Web Worker 混線バグと根本解決メモ](docs/vite_worker_bundling_troubleshooting.md)
