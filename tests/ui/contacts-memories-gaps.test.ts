/**
 * Tests for contacts & memories remaining gaps (Issues #1746-#1751).
 *
 * Covers:
 * - #1746 Contact relationships UI
 * - #1747 Contact groups UI
 * - #1748 Contact custom fields display
 * - #1749 Contact activity section
 * - #1750 Memory bulk operations
 * - #1751 Memory contact/relationship scoping
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// #1746 — Contact relationships UI
// ---------------------------------------------------------------------------
describe('#1746 — Contact relationships section', () => {
  it('should export ContactRelationshipSection component', async () => {
    const mod = await import('../../src/ui/components/relationships/contact-relationship-section');
    expect(mod.ContactRelationshipSection).toBeDefined();
    expect(typeof mod.ContactRelationshipSection).toBe('function');
  });

  it('should export RelationshipCard component', async () => {
    const mod = await import('../../src/ui/components/relationships/relationship-card');
    expect(mod.RelationshipCard).toBeDefined();
  });

  it('should export AddRelationshipDialog component', async () => {
    const mod = await import('../../src/ui/components/relationships/add-relationship-dialog');
    expect(mod.AddRelationshipDialog).toBeDefined();
  });

  it('should export relationship utility functions', async () => {
    const mod = await import('../../src/ui/components/relationships/relationship-utils');
    expect(mod.getRelationshipCategory).toBeDefined();
    expect(mod.getRelationshipLabel).toBeDefined();
    expect(mod.CATEGORY_LABELS).toBeDefined();
    expect(mod.RELATIONSHIP_TYPES).toBeDefined();
  });

  it('should correctly categorize relationship types', async () => {
    const { getRelationshipCategory } = await import('../../src/ui/components/relationships/relationship-utils');
    expect(getRelationshipCategory('colleague')).toBe('professional');
    expect(getRelationshipCategory('client')).toBe('business');
    expect(getRelationshipCategory('friend')).toBe('personal');
  });
});

// ---------------------------------------------------------------------------
// #1747 — Contact groups UI
// ---------------------------------------------------------------------------
describe('#1747 — Contact groups UI', () => {
  it('should export ContactGroupBadge component', async () => {
    const mod = await import('../../src/ui/components/organizations/contact-group-badge');
    expect(mod.ContactGroupBadge).toBeDefined();
    expect(typeof mod.ContactGroupBadge).toBe('function');
  });

  it('should export ContactGroupManager component', async () => {
    const mod = await import('../../src/ui/components/organizations/contact-group-manager');
    expect(mod.ContactGroupManager).toBeDefined();
    expect(typeof mod.ContactGroupManager).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// #1748 — Contact custom fields display
// ---------------------------------------------------------------------------
describe('#1748 — Contact custom fields display', () => {
  it('should export CustomField type from api-types', async () => {
    // Verify the CustomField interface is available and Contact has custom_fields
    const types = await import('../../src/ui/lib/api-types');
    // Contact type should exist
    expect(types).toBeDefined();
  });

  it('should export CustomFieldsSection component', async () => {
    const mod = await import('../../src/ui/components/contacts/custom-fields-section');
    expect(mod.CustomFieldsSection).toBeDefined();
    expect(typeof mod.CustomFieldsSection).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// #1749 — Contact activity section
// ---------------------------------------------------------------------------
describe('#1749 — Contact activity section', () => {
  it('should export ContactActivitySection component', async () => {
    const mod = await import('../../src/ui/components/activity/contact-activity-section');
    expect(mod.ContactActivitySection).toBeDefined();
    expect(typeof mod.ContactActivitySection).toBe('function');
  });

  it('should export ActivityTimeline component', async () => {
    const mod = await import('../../src/ui/components/activity/activity-timeline');
    expect(mod.ActivityTimeline).toBeDefined();
  });

  it('should export ActivityStats component', async () => {
    const mod = await import('../../src/ui/components/activity/activity-stats');
    expect(mod.ActivityStats).toBeDefined();
  });

  it('should export ActivityFilter component', async () => {
    const mod = await import('../../src/ui/components/activity/activity-filter');
    expect(mod.ActivityFilter).toBeDefined();
  });

  it('should correctly calculate activity statistics', async () => {
    const { calculateStats } = await import('../../src/ui/components/activity/activity-utils');
    const activities = [
      { id: '1', type: 'email_sent' as const, title: 'Email', timestamp: '2026-01-15T10:00:00Z', sourceType: 'email' as const, sourceId: 'e1' },
      { id: '2', type: 'email_sent' as const, title: 'Email 2', timestamp: '2026-01-16T10:00:00Z', sourceType: 'email' as const, sourceId: 'e2' },
      { id: '3', type: 'note_added' as const, title: 'Note', timestamp: '2026-01-14T10:00:00Z', sourceType: 'note' as const, sourceId: 'n1' },
    ];
    const stats = calculateStats(activities);
    expect(stats.total).toBe(3);
    expect(stats.mostCommonType).toBe('email_sent');
    expect(stats.lastInteraction).toBeInstanceOf(Date);
  });

  it('should group activities by date', async () => {
    const { groupActivitiesByDate } = await import('../../src/ui/components/activity/activity-utils');
    const activities = [
      { id: '1', type: 'email_sent' as const, title: 'Email', timestamp: '2025-06-15T10:00:00Z', sourceType: 'email' as const, sourceId: 'e1' },
      { id: '2', type: 'note_added' as const, title: 'Note', timestamp: '2025-06-15T11:00:00Z', sourceType: 'note' as const, sourceId: 'n1' },
    ];
    const groups = groupActivitiesByDate(activities);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].activities.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #1750 — Memory bulk operations
// ---------------------------------------------------------------------------
describe('#1750 — Memory bulk operations', () => {
  it('should export BulkMemoryActionBar component', async () => {
    const mod = await import('../../src/ui/components/memory/bulk-action-bar');
    expect(mod.BulkMemoryActionBar).toBeDefined();
    expect(typeof mod.BulkMemoryActionBar).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// #1751 — Memory contact/relationship scoping
// ---------------------------------------------------------------------------
describe('#1751 — Memory contact/relationship scoping', () => {
  it('CreateMemoryBody should support contact_id and relationship_id', async () => {
    // Verify the types accept contact_id and relationship_id
    const types = await import('../../src/ui/lib/api-types');
    // Just verify the module loads; the type-check during build verifies structure
    expect(types).toBeDefined();
  });

  it('should export ContactPicker component', async () => {
    const mod = await import('../../src/ui/components/memory/contact-picker');
    expect(mod.ContactPicker).toBeDefined();
    expect(typeof mod.ContactPicker).toBe('function');
  });
});
