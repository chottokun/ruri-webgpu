export interface ExtractedSentence {
  id: string;
  text: string;
}

export function extractAndSplitSentences(doc: Document): ExtractedSentence[] {
  const elements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li');
  const sentencesMap = new Map<string, string>();
  
  // Use Intl.Segmenter for reliable Japanese sentence splitting
  const segmenter = new Intl.Segmenter('ja', { granularity: 'sentence' });
  let sentenceCounter = 0;

  elements.forEach((el) => {
    // If it's already processed, collect existing IDs
    if (el.hasAttribute('data-ruri-processed')) {
      const spans = el.querySelectorAll('span[data-ruri-id]');
      if (spans.length > 0) {
        spans.forEach(span => {
          const id = span.getAttribute('data-ruri-id')!;
          sentencesMap.set(id, (sentencesMap.get(id) || '') + (span.textContent || ''));
        });
      } else if (el.hasAttribute('data-ruri-id')) {
        const id = el.getAttribute('data-ruri-id')!;
        sentencesMap.set(id, (sentencesMap.get(id) || '') + (el.textContent || ''));
      }
      return;
    }

    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, null);
    const textNodes: { node: Text, start: number, end: number, text: string }[] = [];
    let n: Text | null;
    let offset = 0;
    let combinedText = '';
    
    while ((n = walker.nextNode() as Text)) {
      const text = n.nodeValue || '';
      textNodes.push({ node: n, start: offset, end: offset + text.length, text });
      combinedText += text;
      offset += text.length;
    }
    
    if (combinedText.trim().length === 0) return;

    const segments = Array.from(segmenter.segment(combinedText)).filter(s => s.segment.trim().length > 0);
    if (segments.length === 0) return;

    const indexToId = new Map<number, string>();
    for (const seg of segments) {
      const id = `ruri-sent-${sentenceCounter++}`;
      indexToId.set(seg.index, id);
      sentencesMap.set(id, seg.segment.trim());
    }

    let modified = false;

    // To prevent modification during iteration, gather replacement actions
    const replacements: { node: Text, fragment: DocumentFragment }[] = [];

    for (const textNodeInfo of textNodes) {
      const { node, start, end } = textNodeInfo;
      const parent = node.parentNode;
      if (!parent) continue;
      
      const overlappingSegments = segments.filter(seg => {
        const segStart = seg.index;
        const segEnd = seg.index + seg.segment.length;
        return segStart < end && segEnd > start;
      });
      
      if (overlappingSegments.length === 0) continue;

      const fragment = doc.createDocumentFragment();
      let currentPos = start;
      
      for (const seg of overlappingSegments) {
        const segStart = seg.index;
        const segEnd = seg.index + seg.segment.length;
        
        const overlapStart = Math.max(start, segStart);
        const overlapEnd = Math.min(end, segEnd);
        
        if (overlapStart > currentPos) {
          fragment.appendChild(doc.createTextNode(combinedText.substring(currentPos, overlapStart)));
        }
        
        const span = doc.createElement('span');
        const id = indexToId.get(seg.index)!;
        span.setAttribute('data-ruri-id', id);
        span.textContent = combinedText.substring(overlapStart, overlapEnd);
        fragment.appendChild(span);
        
        currentPos = overlapEnd;
      }
      
      if (currentPos < end) {
        fragment.appendChild(doc.createTextNode(combinedText.substring(currentPos, end)));
      }
      
      replacements.push({ node, fragment });
      modified = true;
    }
    
    // Apply replacements
    for (const { node, fragment } of replacements) {
      node.parentNode?.replaceChild(fragment, node);
    }
    
    if (modified) {
      el.setAttribute('data-ruri-processed', 'true');
    } else {
      // If no text nodes were modified (should be rare if there's text), just mark it
      if (!el.hasAttribute('data-ruri-processed')) {
        el.setAttribute('data-ruri-id', `ruri-sent-${sentenceCounter++}`);
        el.setAttribute('data-ruri-processed', 'true');
      }
    }
  });
  
  const sentences: ExtractedSentence[] = [];
  sentencesMap.forEach((text, id) => {
    sentences.push({ id, text: text.trim() });
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
