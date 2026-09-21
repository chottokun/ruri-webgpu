import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractAndSplitSentences, computeCosineSimilarity, computeHybridScore } from '../extension/utils';

describe('Utils tests', () => {
  describe('extractAndSplitSentences', () => {
    it('should extract text and generate IDs for a simple paragraph', () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body><p>これはテストです。</p></body></html>`);
      const document = dom.window.document;
      
      const sentences = extractAndSplitSentences(document);
      
      expect(sentences).toHaveLength(1);
      expect(sentences[0].text).toBe('これはテストです。');
      expect(sentences[0].id).toMatch(/^ruri-sent-\d+$/);
      
      const p = document.querySelector('p')!;
      expect(p.getAttribute('data-ruri-id')).toBe(sentences[0].id);
      expect(p.getAttribute('data-ruri-processed')).toBe('true');
    });

    it('should split a long paragraph with multiple sentences', () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body><p>第一文です。そして第二文です！最後に第三文？</p></body></html>`);
      const document = dom.window.document;
      
      const sentences = extractAndSplitSentences(document);
      
      expect(sentences).toHaveLength(3);
      expect(sentences[0].text).toBe('第一文です。');
      expect(sentences[1].text).toBe('そして第二文です！');
      expect(sentences[2].text).toBe('最後に第三文？');
      
      const spans = document.querySelectorAll('span[data-ruri-id]');
      expect(spans).toHaveLength(3);
    });

    it('should handle elements with existing IDs gracefully (idempotent)', () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body><p data-ruri-id="ruri-sent-99" data-ruri-processed="true">既に処理済みです。</p></body></html>`);
      const document = dom.window.document;
      
      const sentences = extractAndSplitSentences(document);
      
      expect(sentences).toHaveLength(1);
      expect(sentences[0].text).toBe('既に処理済みです。');
      expect(sentences[0].id).toBe('ruri-sent-99');
    });

    it('should skip splitting if there are HTML child elements to avoid breaking them', () => {
      const dom = new JSDOM(`<!DOCTYPE html><html><body><p>リンクを含む文です。<a href="#">ここをクリック</a>。分割しません。</p></body></html>`);
      const document = dom.window.document;
      
      const sentences = extractAndSplitSentences(document);
      
      expect(sentences).toHaveLength(1);
      expect(sentences[0].text).toBe('リンクを含む文です。ここをクリック。分割しません。');
      
      const p = document.querySelector('p')!;
      expect(p.innerHTML).toContain('<a href="#">');
    });
  });

  describe('computeCosineSimilarity', () => {
    it('should compute the correct similarity for two identical vectors', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([1, 0]);
      expect(computeCosineSimilarity(vecA, vecB)).toBe(1);
    });

    it('should compute the correct similarity for orthogonal vectors', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([0, 1]);
      expect(computeCosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should compute the correct similarity for opposite vectors', () => {
      const vecA = new Float32Array([1, 0]);
      const vecB = new Float32Array([-1, 0]);
      expect(computeCosineSimilarity(vecA, vecB)).toBe(-1);
    });
  });

  describe('computeHybridScore', () => {
    it('should boost the score by 0.25 if the query matches the text', () => {
      const result = computeHybridScore(0.5, '私はりんごが好きです', 'りんご', true);
      expect(result.score).toBe(0.75);
      expect(result.matched).toBe(true);
    });

    it('should not boost the score if the query does not match', () => {
      const result = computeHybridScore(0.5, '私はりんごが好きです', 'みかん', true);
      expect(result.score).toBe(0.5);
      expect(result.matched).toBe(false);
    });

    it('should not boost the score if isHybrid is false', () => {
      const result = computeHybridScore(0.5, '私はりんごが好きです', 'りんご', false);
      expect(result.score).toBe(0.5);
      expect(result.matched).toBe(false);
    });
    
    it('should be case-insensitive for matching', () => {
      const result = computeHybridScore(0.5, 'Test sentence', 'TEST', true);
      expect(result.score).toBe(0.75);
      expect(result.matched).toBe(true);
    });
  });
});
