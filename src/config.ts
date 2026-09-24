/**
 * ruri-webgpu 設定ファイル
 * 参照: chottokun/ruri_with_sentencepiece_lite (dist_assets/ruri_v3_lite.py)
 */

// ruri-v3 特殊トークン ID
export const SPECIAL_TOKENS = {
  BOS_ID: 1, // <s>
  EOS_ID: 2, // </s>
  PAD_ID: 3, // <pad>
} as const;

// プレフィックス（検索クエリ / 文書で使い分け）
export const PREFIXES = {
  query: '検索クエリ: ',
  doc: '文章: ',
} as const;

// Hugging Face Hub 設定
export const HF_CONFIG = {
  repoId: 'Chottokun/ruri-v3-30m-lite',
  baseUrl: 'https://huggingface.co/Chottokun/ruri-v3-30m-lite/resolve/main',
  files: {
    tokenizerJson: 'tokenizer.json', // tokenizer configuration
    tokenizerFb: 'ruri_v3_30m.spm.fb', // FlatBuffers 形式辞書 (4.57MB)
    modelFp16: 'model_fp16.onnx', // 71MB - WebGPU 用 (FP16)
    modelFp32: 'model.onnx', // 141MB - WASM CPU フォールバック用 (FP32)
  },
  cacheName: 'ruri-v3-30m-lite-cache-v1',
} as const;

// モデル仕様
export const EMBED_DIM = 256; // 埋め込みベクトルの次元数
export const MAX_LENGTH = 512; // 最大シーケンス長
