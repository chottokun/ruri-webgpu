# Vite における ONNX Runtime Web Worker 混線バグと根本解決メモ

## 1. トラブルシューティングの経緯

### 発生した現象
ローカル開発サーバー（`vite`）では正常に動作していたにもかかわらず、プロダクションビルド（`vite build`）して GitHub Pages にデプロイした際、以下の症状が発生しました：
1. 画面が **「判定中...」** のままプログレスが進まず、一切の推論・インデックス作成が停止する。
2. ブラウザの DevTools コンソールに以下の未捕捉エラーが出力される：
   ```text
   worker sent an error! assets/index-*.js:1: Uncaught ReferenceError: document is not defined
   TypeError: r._OrtGetInputOutputMetadata is not a function
   ```

---

## 2. 根本原因のメカニズム

1. **Vite / Rollup の ESM Worker 解決動作**:
   - `onnxruntime-web` は、マルチスレッドやバックグラウンド計算のために内部で Web Worker を動的生成（`new Worker(...)`）します。
   - Vite のプロダクションビルド時、バンドラーが `onnxruntime-web` 内部の Worker 参照先を、**メインスレッド用の JavaScript バンドル（`index-*.js`）と同じ URL** に解決・巻き込んでしまいました。
2. **Worker コンテキスト内での DOM API 実行**:
   - Web Worker には DOM 環境（`window` や `document`）が存在しません。
   - メイン画面用のコード（`document.getElementById(...)` 等を含む）が Worker 内で実行された瞬間に `ReferenceError: document is not defined` で Worker スレッドがクラッシュしました。
3. **WASM 初期化プロミスのハング**:
   - Worker のクラッシュにより、ONNX Runtime Web の WASM コア初期化関数（`_OrtGetInputOutputMetadata`）が呼び出されず、セッション生成の `Promise` が永久に解決しない状態（「判定中」でフリーズ）に陥っていました。

---

## 3. 施した根本対策とアーキテクチャ

### 採用した解決策: スタンドアローン CDN 構成 + 型専用 import

1. **`index.html` でスタンドアローン版スクリプトを先行ロード**:
   ```html
   <!-- ONNX Runtime Web (CDNからスタンドアローン版をロードしWorkerバンドル混線を防止) -->
   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.min.js"></script>
   ```
   - これにより、`window.ort` がグローバルスコープに配置され、WASM / Worker の読み込みパスがライブラリ内部で自己完結します。

2. **TypeScript 側では `import type`（型のみ）を使用**:
   ```typescript
   // 実行時 import ではなく、型情報のみを import する
   import type * as ort from 'onnxruntime-web';

   function getOrt(): typeof ort {
     const globalOrt = (typeof window !== 'undefined' && (window as any).ort);
     if (!globalOrt) {
       throw new Error('ONNX Runtime Web (ort) が読み込まれていません。');
     }
     return globalOrt;
   }
   ```
   - **効果**:
     - TypeScript の型チェックは 100% 効いたまま維持されます。
     - バンドル後の JavaScript コードに `import "onnxruntime-web"` が 1 文字も残らないため、ブラウザネイティブの `Failed to resolve module specifier` エラーも防止されます。
     - Vite が Worker を独自ビルドしようとする余地を完全に排除できます。

3. **成果物の軽量化**:
   - バンドルから 28MB の余分な WASM コピーが排除され、メイン JS も **1.2MB → 770KB** に大幅軽量化されました。

---

## 関連ドキュメント

- [Chrome 拡張機能仕様・利用ガイド](./EXTENSION.md)
- [日本語特化トークナイザーにおける英字クエリの挙動と対策](./tokenizer_insights.md)
