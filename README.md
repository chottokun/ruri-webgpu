# ruri-webgpu

ruri-v3-30m-liteの WebGPU 日本語セマンティック検索デモ

## 概要

`ruri-webgpu` は、Hugging Face Hub 上に公開されている [`Chottokun/ruri-v3-30m-lite`](https://huggingface.co/Chottokun/ruri-v3-30m-lite) のモデルおよび辞書をブラウザから直接取得（Cache API 永続化）し、WebGPU による高速な推論で完全クライアントサイド日本語セマンティック検索を実現する Web アプリケーションです。

## 主な特徴

- **ゼロ・インフラ / ゼロ・サーバーコスト**: 静的ホスティング（GitHub Pages）のみで動作し、バックエンドサーバーは不要です。
- **WebGPU 高速推論**: WebGPU 対応環境では FP16 モデル (`model_fp16.onnx`) を使用して低レイテンシで埋め込みベクトルを生成します（非対応時は WASM CPU フォールバック）。
- **Cache API 永続化**: 初回ダウンロード以降はブラウザキャッシュから即座にロードされます。
- **純粋な SentencePiece トークナイザー**: 参照実装 [`chottokun/ruri_with_sentencepiece_lite`](https://github.com/chottokun/ruri_with_sentencepiece_lite) と同一のトークン化・プーリングロジックを TypeScript 上に移植しています。

## 開発

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

## Chrome 拡張機能

Web記事の閲覧中に `Ctrl+F` / `Cmd+F` (または `Ctrl+K`, `Ctrl+Shift+F`) で即座に呼び出せる、WebGPU 活用型インライン意味検索拡張機能を提供しています。

**導入手順**:
1. `npm run build:extension` で拡張機能をビルドします（または `npm run zip:extension` でZIPを生成し解凍）。
2. Chrome で `chrome://extensions/` を開き、「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」から、ビルドされた `dist-extension/` フォルダを選択して導入します。

**主な操作**:
- `Enter` / `Shift+Enter`: 次/前の一致箇所へ移動
- `Alt+H`: ハイライト表示のトグル
- `Esc`: 検索バーを閉じる

詳細は [Chrome 拡張機能ドキュメント](docs/EXTENSION.md) を参照してください。

## 技術ドキュメント

- [Chrome 拡張機能仕様・利用ガイド](docs/EXTENSION.md)
- [日本語特化トークナイザーにおける英字クエリの挙動と対策](docs/tokenizer_insights.md)
- [Vite における ONNX Runtime Web Worker 混線バグと根本解決メモ](docs/vite_worker_bundling_troubleshooting.md)


