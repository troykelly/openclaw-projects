import { describe, it, expect } from 'vitest';

/**
 * Issue #53: canonical hierarchy semantics.
 *
 * This test is intentionally failing until the schema + API work exists.
 */
describe('hierarchy model (Initiative/Epic/Issue)', () => {
  it('TODO: initiatives can contain epics; epics can contain issues; invalid nesting is rejected', async () => {
    // Placeholder failing test to drive first slice.
    expect(true).toBe(false);
  });
});
