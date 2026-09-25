export interface ExtractedSentence {
  id: string;
  text: string;
  ranges?: Range[];
  element?: HTMLElement;
}

export function extractAndSplitSentences(doc: Document): ExtractedSentence[] {
  // GitHub や一般的な Web ページのテキストを含む要素（末端のブロック・テキスト要素）を網羅
  const rawElements = doc.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, pre, dt, dd, summary, figcaption, .react-code-text, [data-code-text]'
  );
  
  // 親要素に別の対象要素が含まれる場合は末端側を優先し、親側での二重抽出を防ぐ
  const targetElements: HTMLElement[] = [];
  rawElements.forEach((node) => {
    const el = node as HTMLElement;
    // スクリプトやスタイル、オーバーレイ自身は除外
    if (el.closest('#ruri-overlay-root') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
      return;
    }
    const hasChildTarget = el.querySelector(
      'h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, pre, dt, dd, summary, figcaption, .react-code-text, [data-code-text]'
    );
    if (hasChildTarget) {
      return;
    }
    targetElements.push(el);
  });

  const sentences: ExtractedSentence[] = [];
  const segmenter = new Intl.Segmenter('ja', { granularity: 'sentence' });
  let sentenceCounter = 0;

  // 既に走査済みのテキストノードを追跡して重複抽出を防止
  const visitedTextNodes = new Set<Node>();

  targetElements.forEach((el) => {
    el.setAttribute('data-ruri-processed', 'true');
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, null);
    const textNodes: { node: Text; start: number; end: number; text: string }[] = [];
    let n: Text | null;
    let offset = 0;
    let combinedText = '';

    while ((n = walker.nextNode() as Text)) {
      if (visitedTextNodes.has(n)) continue;
      const text = n.nodeValue || '';
      if (!text.trim()) continue;

      visitedTextNodes.add(n);
      textNodes.push({ node: n, start: offset, end: offset + text.length, text });
      combinedText += text;
      offset += text.length;
    }

    if (combinedText.trim().length === 0) return;

    // 日本語文分割
    const segments = Array.from(segmenter.segment(combinedText)).filter(s => s.segment.trim().length > 0);
    if (segments.length === 0) return;

    for (const seg of segments) {
      const segText = seg.segment.trim();
      const segStart = seg.index;
      const segEnd = seg.index + seg.segment.length;
      const id = `ruri-sent-${sentenceCounter++}`;

      // 各文に対応する Range を作成（DOMツリーを破壊せずに文字位置を正確に参照）
      const ranges: Range[] = [];

      for (const tInfo of textNodes) {
        if (tInfo.end <= segStart || tInfo.start >= segEnd) {
          continue;
        }

        const nodeStart = Math.max(0, segStart - tInfo.start);
        const nodeEnd = Math.min(tInfo.text.length, segEnd - tInfo.start);

        if (nodeStart < nodeEnd) {
          try {
            const range = doc.createRange();
            range.setStart(tInfo.node, nodeStart);
            range.setEnd(tInfo.node, nodeEnd);
            ranges.push(range);
          } catch (e) {
            // Range 作成エラー時はスキップ
          }
        }
      }

      // フォールバック用の要素参照
      if (ranges.length > 0) {
        const parentEl = ranges[0].startContainer.parentElement;
        if (parentEl && !parentEl.hasAttribute('data-ruri-id')) {
          parentEl.setAttribute('data-ruri-id', id);
        }
      }

      sentences.push({
        id,
        text: segText,
        ranges,
        element: el
      });
    }
  });

  return sentences;
}

export function escapeHtml(unsafe: string): string {
  return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

export function computeCosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

export function computeHybridScore(
  cosineSim: number,
  text: string,
  query: string,
  isHybrid: boolean
): { score: number; matched: boolean } {
  if (!isHybrid) {
    return { score: cosineSim, matched: false };
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();

  // 完全一致または部分一致の判定
  if (normalizedQuery.length > 0 && normalizedText.includes(normalizedQuery)) {
    // 一致した場合は +0.25 ブースト
    return { score: cosineSim + 0.25, matched: true };
  }

  // クエリが複数単語の場合（空白区切り）、いずれかの単語が含まれているか判定
  const queryTokens = normalizedQuery.split(/\s+/).filter(t => t.length > 1);
  if (queryTokens.length > 1) {
    const hasAny = queryTokens.some(token => normalizedText.includes(token));
    if (hasAny) {
      return { score: cosineSim + 0.15, matched: true };
    }
  }

  return { score: cosineSim, matched: false };
}
