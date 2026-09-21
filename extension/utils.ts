export interface ExtractedSentence {
  id: string;
  text: string;
}

export function extractAndSplitSentences(doc: Document): ExtractedSentence[] {
  const elements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li');
  const sentences: ExtractedSentence[] = [];
  
  // Use Intl.Segmenter for reliable Japanese sentence splitting
  const segmenter = new Intl.Segmenter('ja', { granularity: 'sentence' });
  let sentenceCounter = 0;

  elements.forEach((el) => {
    const text = (el.textContent || '').trim();
    if (!text) return;
    
    // We only process if it doesn't already have an ID (idempotent)
    // For this implementation, we'll wrap sentences in spans to allow pinpoint highlighting,
    // or if it's a single sentence, just tag the element itself.
    
    // As modifying the DOM heavily can break things, we'll instead do this:
    // If an element has multiple sentences, we rewrite its innerHTML to wrap them in spans.
    // If we already did this, we skip rewriting.
    if (el.hasAttribute('data-ruri-processed')) {
      // Extract from spans or the element itself
      const spans = el.querySelectorAll('span[data-ruri-id]');
      if (spans.length > 0) {
        spans.forEach(span => {
          sentences.push({ id: span.getAttribute('data-ruri-id')!, text: span.textContent || '' });
        });
      } else if (el.hasAttribute('data-ruri-id')) {
        sentences.push({ id: el.getAttribute('data-ruri-id')!, text: text });
      }
      return;
    }

    const segments = Array.from(segmenter.segment(text)).map(s => s.segment.trim()).filter(s => s.length > 0);
    
    if (segments.length === 0) return;
    
    if (segments.length === 1) {
      const id = `ruri-sent-${sentenceCounter++}`;
      el.setAttribute('data-ruri-id', id);
      el.setAttribute('data-ruri-processed', 'true');
      sentences.push({ id, text: segments[0] });
    } else {
      // Multiple sentences: replace innerHTML with spans, being careful with existing HTML
      // A naive approach: if there's no HTML inside, just text, we can wrap.
      // If there are child elements (e.g. <a>), splitting gets complex. 
      // For simplicity in this demo, if there are child elements, we treat the whole element as one sentence block,
      // or we just replace text. Let's check for child elements.
      if (el.children.length === 0) {
        const spanNodes = segments.map(seg => {
          const id = `ruri-sent-${sentenceCounter++}`;
          sentences.push({ id, text: seg });
          return `<span data-ruri-id="${id}">${escapeHtml(seg)}</span>`;
        });
        el.innerHTML = spanNodes.join('');
        el.setAttribute('data-ruri-processed', 'true');
      } else {
        // Fallback: don't split if there are children to avoid breaking links/formatting
        const id = `ruri-sent-${sentenceCounter++}`;
        el.setAttribute('data-ruri-id', id);
        el.setAttribute('data-ruri-processed', 'true');
        sentences.push({ id, text });
      }
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
  similarity: number, 
  text: string, 
  query: string, 
  isHybrid: boolean = true
): { score: number, matched: boolean } {
  let finalScore = similarity;
  let matched = false;
  
  const searchPattern = query.trim().toLowerCase();
  
  if (isHybrid && searchPattern.length > 0) {
    if (text.toLowerCase().includes(searchPattern)) {
      finalScore += 0.25;
      matched = true;
    }
  }
  
  return { score: finalScore, matched };
}
