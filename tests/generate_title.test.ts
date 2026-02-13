import { describe, expect, it } from 'vitest';
import { generateTitleFromContent } from '../src/api/memory/service.ts';

describe('generateTitleFromContent', () => {
  it('extracts first sentence ending with period', () => {
    expect(generateTitleFromContent('User prefers dark mode. Other info.')).toBe('User prefers dark mode');
  });

  it('extracts first sentence ending with exclamation', () => {
    expect(generateTitleFromContent('Important! Remember this.')).toBe('Important');
  });

  it('extracts first sentence ending with question mark', () => {
    expect(generateTitleFromContent('What is the preference? It is dark mode.')).toBe('What is the preference');
  });

  it('extracts first line when separated by newline', () => {
    expect(generateTitleFromContent('First line\nSecond line')).toBe('First line');
  });

  it('truncates long first sentence at word boundary', () => {
    const long = 'This is a very long sentence that goes on and on and on and on and on and on and on and on and on and on and on and on forever and ever.';
    const result = generateTitleFromContent(long);
    expect(result.length).toBeLessThanOrEqual(123); // 120 + "..."
    expect(result).toMatch(/\.\.\.$/);
  });

  it('uses first clause when no sentence boundary', () => {
    expect(generateTitleFromContent('Coffee preference, always oat milk always')).toBe('Coffee preference');
  });

  it('falls back to truncated content when no boundaries', () => {
    const noBreaks = 'a '.repeat(100).trim();
    const result = generateTitleFromContent(noBreaks);
    expect(result.length).toBeLessThanOrEqual(123);
  });

  it('returns full content when short enough', () => {
    expect(generateTitleFromContent('Short note')).toBe('Short note');
  });

  it('handles empty content', () => {
    expect(generateTitleFromContent('')).toBe('Untitled memory');
    expect(generateTitleFromContent('   ')).toBe('Untitled memory');
  });
});
