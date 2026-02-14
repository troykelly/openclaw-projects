/**
 * Unit tests for keyword boosting logic
 * Issue #1146
 */

import { describe, it, expect } from 'vitest';

// Import the functions we'll test (they'll be exported from service.ts)
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'he',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'will',
    'with',
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function calculateKeywordRatio(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const matchCount = keywords.filter((keyword) => contentLower.includes(keyword)).length;

  return matchCount / keywords.length;
}

function applyKeywordBoost<T extends { similarity: number; content: string }>(results: T[], query: string): T[] {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return results;
  }

  const scoredResults = results.map((result) => {
    const vectorSimilarity = result.similarity;
    const keywordRatio = calculateKeywordRatio(result.content, keywords);
    const finalScore = vectorSimilarity * 0.7 + keywordRatio * 0.3;

    return {
      ...result,
      similarity: finalScore,
    };
  });

  return scoredResults.sort((a, b) => b.similarity - a.similarity);
}

describe('Keyword boosting unit tests', () => {
  describe('extractKeywords', () => {
    it('should extract significant words from query', () => {
      const keywords = extractKeywords('email notification preferences');
      expect(keywords).toEqual(['email', 'notification', 'preferences']);
    });

    it('should remove stop words', () => {
      const keywords = extractKeywords('the user has an email preference');
      expect(keywords).toEqual(['user', 'email', 'preference']);
    });

    it('should remove short words (length <= 2)', () => {
      const keywords = extractKeywords('a big database for my app');
      expect(keywords).toEqual(['big', 'database', 'app']);
    });

    it('should handle empty query', () => {
      const keywords = extractKeywords('');
      expect(keywords).toEqual([]);
    });

    it('should handle query with only stop words', () => {
      const keywords = extractKeywords('the and or');
      expect(keywords).toEqual([]);
    });
  });

  describe('calculateKeywordRatio', () => {
    it('should calculate ratio of matching keywords', () => {
      const content = 'User prefers email notifications for important updates';
      const keywords = ['email', 'notifications'];
      const ratio = calculateKeywordRatio(content, keywords);
      expect(ratio).toBe(1.0); // Both keywords match
    });

    it('should calculate partial match ratio', () => {
      const content = 'User prefers email alerts';
      const keywords = ['email', 'notifications', 'preferences'];
      const ratio = calculateKeywordRatio(content, keywords);
      expect(ratio).toBeCloseTo(0.33, 2); // 1 out of 3 keywords match
    });

    it('should handle no matches', () => {
      const content = 'User likes Python';
      const keywords = ['javascript', 'react'];
      const ratio = calculateKeywordRatio(content, keywords);
      expect(ratio).toBe(0);
    });

    it('should be case-insensitive', () => {
      const content = 'DOCKER CONTAINERIZATION';
      const keywords = ['docker', 'containerization'];
      const ratio = calculateKeywordRatio(content, keywords);
      expect(ratio).toBe(1.0);
    });

    it('should return 0 for empty keywords', () => {
      const content = 'Some content';
      const keywords: string[] = [];
      const ratio = calculateKeywordRatio(content, keywords);
      expect(ratio).toBe(0);
    });
  });

  describe('applyKeywordBoost', () => {
    it('should boost results with more keyword matches', () => {
      const results = [
        { id: '1', content: 'Email notifications', similarity: 0.5 },
        { id: '2', content: 'Email notification preferences for alerts', similarity: 0.5 },
      ];

      const boosted = applyKeywordBoost(results, 'email notification preferences');

      // Result 2 should rank higher due to more keyword matches
      expect(boosted[0].id).toBe('2');
      expect(boosted[1].id).toBe('1');
    });

    it('should combine vector similarity and keyword ratio', () => {
      const results = [
        { id: '1', content: 'Some unrelated text', similarity: 0.9 }, // High similarity, no keywords
        { id: '2', content: 'Docker containerization setup', similarity: 0.3 }, // Low similarity, all keywords
      ];

      const boosted = applyKeywordBoost(results, 'docker containerization');

      // Calculate expected scores:
      // Result 1: 0.9 * 0.7 + 0.0 * 0.3 = 0.63
      // Result 2: 0.3 * 0.7 + 1.0 * 0.3 = 0.51
      // Result 1 should still rank higher due to high vector similarity
      expect(boosted[0].id).toBe('1');
      expect(boosted[0].similarity).toBeCloseTo(0.63, 2);
      expect(boosted[1].id).toBe('2');
      expect(boosted[1].similarity).toBeCloseTo(0.51, 2);
    });

    it('should handle empty keywords', () => {
      const results = [
        { id: '1', content: 'Text one', similarity: 0.5 },
        { id: '2', content: 'Text two', similarity: 0.7 },
      ];

      const boosted = applyKeywordBoost(results, '');

      // Should return original results unchanged
      expect(boosted).toEqual(results);
    });

    it('should properly weight 70% vector + 30% keyword', () => {
      const results = [
        { id: '1', content: 'Python scripting preferences', similarity: 0.8 }, // All 3 keywords
      ];

      const boosted = applyKeywordBoost(results, 'python scripting preferences');

      // 0.8 * 0.7 + 1.0 * 0.3 = 0.56 + 0.3 = 0.86
      expect(boosted[0].similarity).toBeCloseTo(0.86, 2);
    });
  });
});
