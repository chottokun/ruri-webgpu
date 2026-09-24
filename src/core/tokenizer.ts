/**
 * SentencePiece トークナイザーモジュール
 * Hugging Face Hub から取得した tokenizer.model をロードし、
 * ruri-v3 の仕様に準拠した input_ids, attention_mask, token_type_ids を生成します。
 * 参照: chottokun/ruri_with_sentencepiece_lite (dist_assets/ruri_v3_lite.py)
 */

import { Tokenizer } from '@huggingface/tokenizers';
import { SPECIAL_TOKENS, MAX_LENGTH } from '../config';

export interface TokenizedInputs {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
  seqLength: number;
}

export class SpmTokenizer {
  private processor: Tokenizer | null = null;
  private isLoaded: boolean = false;

  /**
   * tokenizer.model のバイナリデータ (ArrayBuffer または Uint8Array) から初期化します。
   */
  async loadModel(modelBuffer: ArrayBuffer | Uint8Array): Promise<void> {
    const jsonString = new TextDecoder().decode(modelBuffer);
    const tokenizerJson = JSON.parse(jsonString);
    const tokenizerConfig = {}; // @huggingface/tokenizers expects config as second param
    this.processor = new Tokenizer(tokenizerJson, tokenizerConfig);
    this.isLoaded = true;
  }

  /**
   * 単一のテキストをサブワード ID 配列に変換します。
   */
  encode(text: string): number[] {
    if (!this.isLoaded || !this.processor) {
      throw new Error('トークナイザーが初期化されていません。先に loadModel を呼び出してください。');
    }
    // 特殊トークンを含めずにエンコード
    return Array.from(this.processor.encode(text, { add_special_tokens: false }).ids);
  }

  /**
   * プレフィックスを付与し、[BOS, ...tokens, EOS] の完全トークン列を生成します。
   */
  tokenize(text: string, prefix: string = ''): number[] {
    const fullText = prefix ? `${prefix}${text}` : text;
    const subwordIds = this.encode(fullText);
    return [SPECIAL_TOKENS.BOS_ID, ...subwordIds, SPECIAL_TOKENS.EOS_ID];
  }

  /**
   * ONNX Runtime 推論用のテンソル入力データを生成します。
   */
  encodeForModel(
    text: string,
    prefix: string = '',
    maxLength: number = MAX_LENGTH
  ): TokenizedInputs {
    const tokens = this.tokenize(text, prefix);
    const truncated = tokens.slice(0, maxLength);
    const seqLength = truncated.length;

    const inputIds = new BigInt64Array(seqLength);
    const attentionMask = new BigInt64Array(seqLength);
    const tokenTypeIds = new BigInt64Array(seqLength);

    for (let i = 0; i < seqLength; i++) {
      inputIds[i] = BigInt(truncated[i]);
      attentionMask[i] = 1n;
      tokenTypeIds[i] = 0n;
    }

    return {
      inputIds,
      attentionMask,
      tokenTypeIds,
      seqLength,
    };
  }
}
