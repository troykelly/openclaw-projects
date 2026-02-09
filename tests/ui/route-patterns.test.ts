/**
 * Tests for route pattern utilities.
 * Issue #673: Hardcoded regex patterns for route matching
 */
import { describe, it, expect } from 'vitest';
import { ROUTE_PATTERNS, matchNotesRoute, matchWorkItemsRoute, extractWorkItemId } from '@/ui/lib/route-patterns';

describe('ROUTE_PATTERNS', () => {
  describe('notebookNote', () => {
    it('matches /notebooks/:notebookId/notes/:noteId', () => {
      const match = ROUTE_PATTERNS.notebookNote.exec('/notebooks/abc-123/notes/def-456');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('abc-123');
      expect(match?.[2]).toBe('def-456');
    });

    it('matches with trailing slash', () => {
      const match = ROUTE_PATTERNS.notebookNote.exec('/notebooks/abc-123/notes/def-456/');
      expect(match).not.toBeNull();
    });

    it('does not match /notebooks/:notebookId', () => {
      const match = ROUTE_PATTERNS.notebookNote.exec('/notebooks/abc-123');
      expect(match).toBeNull();
    });
  });

  describe('notebook', () => {
    it('matches /notebooks/:notebookId', () => {
      const match = ROUTE_PATTERNS.notebook.exec('/notebooks/abc-123');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('abc-123');
    });

    it('does not match /notebooks/:notebookId/notes/:noteId', () => {
      const match = ROUTE_PATTERNS.notebook.exec('/notebooks/abc-123/notes/def-456');
      expect(match).toBeNull();
    });
  });

  describe('note', () => {
    it('matches /notes/:noteId', () => {
      const match = ROUTE_PATTERNS.note.exec('/notes/abc-123');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('abc-123');
    });

    it('does not match /notes', () => {
      const match = ROUTE_PATTERNS.note.exec('/notes');
      expect(match).toBeNull();
    });
  });

  describe('workItemDetail', () => {
    it('matches /work-items/:id', () => {
      const match = ROUTE_PATTERNS.workItemDetail.exec('/work-items/item-123');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('item-123');
    });

    it('does not match /work-items/:id/timeline', () => {
      const match = ROUTE_PATTERNS.workItemDetail.exec('/work-items/item-123/timeline');
      expect(match).toBeNull();
    });
  });

  describe('workItemTimeline', () => {
    it('matches /work-items/:id/timeline', () => {
      const match = ROUTE_PATTERNS.workItemTimeline.exec('/work-items/item-123/timeline');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('item-123');
    });
  });

  describe('workItemGraph', () => {
    it('matches /work-items/:id/graph', () => {
      const match = ROUTE_PATTERNS.workItemGraph.exec('/work-items/item-123/graph');
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('item-123');
    });
  });
});

describe('matchNotesRoute', () => {
  it('returns undefined for non-notes routes', () => {
    expect(matchNotesRoute('/dashboard')).toBeUndefined();
    expect(matchNotesRoute('/work-items')).toBeUndefined();
    expect(matchNotesRoute('/contacts')).toBeUndefined();
  });

  it('returns list type for /notes', () => {
    expect(matchNotesRoute('/notes')).toEqual({ type: 'list' });
  });

  it('returns note type with noteId for /notes/:noteId', () => {
    expect(matchNotesRoute('/notes/abc-123')).toEqual({
      type: 'note',
      noteId: 'abc-123',
    });
  });

  it('returns notebook type with notebookId for /notebooks/:notebookId', () => {
    expect(matchNotesRoute('/notebooks/abc-123')).toEqual({
      type: 'notebook',
      notebookId: 'abc-123',
    });
  });

  it('returns notebookNote type with both IDs for /notebooks/:notebookId/notes/:noteId', () => {
    expect(matchNotesRoute('/notebooks/abc-123/notes/def-456')).toEqual({
      type: 'notebookNote',
      notebookId: 'abc-123',
      noteId: 'def-456',
    });
  });
});

describe('matchWorkItemsRoute', () => {
  it('returns undefined for non-work-items routes', () => {
    expect(matchWorkItemsRoute('/dashboard')).toBeUndefined();
    expect(matchWorkItemsRoute('/notes')).toBeUndefined();
    expect(matchWorkItemsRoute('/contacts')).toBeUndefined();
  });

  it('returns list type for /work-items', () => {
    expect(matchWorkItemsRoute('/work-items')).toEqual({ type: 'list' });
  });

  it('returns detail type with id for /work-items/:id', () => {
    expect(matchWorkItemsRoute('/work-items/item-123')).toEqual({
      type: 'detail',
      id: 'item-123',
    });
  });

  it('returns timeline type with id for /work-items/:id/timeline', () => {
    expect(matchWorkItemsRoute('/work-items/item-123/timeline')).toEqual({
      type: 'timeline',
      id: 'item-123',
    });
  });

  it('returns graph type with id for /work-items/:id/graph', () => {
    expect(matchWorkItemsRoute('/work-items/item-123/graph')).toEqual({
      type: 'graph',
      id: 'item-123',
    });
  });
});

describe('extractWorkItemId', () => {
  it('returns undefined for non-work-items routes', () => {
    expect(extractWorkItemId('/dashboard')).toBeUndefined();
    expect(extractWorkItemId('/notes')).toBeUndefined();
  });

  it('returns undefined for /work-items (list)', () => {
    expect(extractWorkItemId('/work-items')).toBeUndefined();
  });

  it('extracts id from /work-items/:id', () => {
    expect(extractWorkItemId('/work-items/item-123')).toBe('item-123');
  });

  it('extracts id from /work-items/:id/timeline', () => {
    expect(extractWorkItemId('/work-items/item-123/timeline')).toBe('item-123');
  });

  it('extracts id from /work-items/:id/graph', () => {
    expect(extractWorkItemId('/work-items/item-123/graph')).toBe('item-123');
  });
});
