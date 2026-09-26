# Vite における ONNX Runtime Web Worker 混線バグと根本解決メモ

## 1. トラブルシューティングの経緯

### 発生した現象
ローカル開発サーバー（`vite`）では動作していた環境において、プロダクションビルド（`vite build`）後に以下の問題が発生しました：
1. 画面が「判定中...」のままプログレスが進行せず、推論・インデックス作成が停止する。
2. ブラウザのコンソールに以下のエラーが出力される：
   ```text
   worker sent an error! assets/index-*.js:1: Uncaught ReferenceError: document is not defined
   TypeError: r._OrtGetInputOutputMetadata is not a function
   ```

---

## 2. 根本原因のメカニズム

1. **Vite / Rollup の ESM Worker 解決動作**:
   - `onnxruntime-web` は、内部で Web Worker を動的生成（`new Worker(...)`）します。
   - Vite のプロダクションビルド時、バンドラーが `onnxruntime-web` 内部の Worker 参照先を、メインスレッド用の JavaScript バンドル（`index-*.js`）と同じ URL に解決する挙動が発生しました。
2. **Worker コンテキスト内での DOM API 実行**:
   - Web Worker には DOM 環境（`window` や `document`）が存在しません。
   - メイン画面用のコード（`document.getElementById(...)` 等を含む）が Worker 内で実行されたため、`ReferenceError: document is not defined` で Worker スレッドが停止しました。
3. **WASM 初期化プロミスの未解決**:
   - Worker の停止により、ONNX Runtime Web の WASM コア初期化関数（`_OrtGetInputOutputMetadata`）が呼び出されず、セッション生成の `Promise` が解決されない状態になっていました。

---

## 3. 採用した解決策とアーキテクチャ

### スタンドアローン構成 + 型専用 import

1. **`index.html` でスタンドアローン版スクリプトを先行ロード**:
   ```html
   <!-- ONNX Runtime Web (CDNからスタンドアローン版をロードしWorkerバンドル混線を防止) -->
   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.min.js"></script>
   ```
   - これにより、`window.ort` がグローバルスコープに配置され、WASM / Worker の読み込みパスがライブラリ内部で解決されます。

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
     - TypeScript の型チェックは維持されます。
     - バンドル後の JavaScript コードに `import "onnxruntime-web"` が含まれないため、モジュール解決エラーを回避できます。
     - Vite が Worker を独自ビルドしようとする動作を防止できます。

3. **成果物のサイズ最適化**:
   - バンドルから余分な WASM コピーが排除され、メインの JavaScript ファイルサイズが軽量化されました。

---

## 関連ドキュメント

- [Chrome 拡張機能仕様・利用ガイド](./EXTENSION.md)
- [日本語特化トークナイザーにおける英字クエリの挙動と対策](./tokenizer_insights.md)
