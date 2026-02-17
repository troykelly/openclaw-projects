/**
 * @vitest-environment jsdom
 * Tests for contact relationship components
 * Issue #395: Implement contact relationship types
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { RelationshipBadge, type RelationshipBadgeProps } from '@/ui/components/relationships/relationship-badge';
import { RelationshipCard, type RelationshipCardProps } from '@/ui/components/relationships/relationship-card';
import { AddRelationshipDialog, type AddRelationshipDialogProps } from '@/ui/components/relationships/add-relationship-dialog';
import { RelationshipFilter, type RelationshipFilterProps } from '@/ui/components/relationships/relationship-filter';
import { ContactRelationshipSection, type ContactRelationshipSectionProps } from '@/ui/components/relationships/contact-relationship-section';
import type { RelationshipType, RelationshipStrength, ContactRelationship, Contact } from '@/ui/components/relationships/types';
import { RELATIONSHIP_TYPES, getRelationshipLabel, getRelationshipCategory } from '@/ui/components/relationships/relationship-utils';

describe('RelationshipBadge', () => {
  const defaultProps: RelationshipBadgeProps = {
    type: 'colleague',
  };

  it('should render relationship type label', () => {
    render(<RelationshipBadge {...defaultProps} />);
    expect(screen.getByText('Colleague')).toBeInTheDocument();
  });

  it('should apply category-based styling for professional', () => {
    render(<RelationshipBadge type="colleague" />);
    const badge = screen.getByTestId('relationship-badge');
    expect(badge).toHaveAttribute('data-category', 'professional');
  });

  it('should apply category-based styling for business', () => {
    render(<RelationshipBadge type="client" />);
    const badge = screen.getByTestId('relationship-badge');
    expect(badge).toHaveAttribute('data-category', 'business');
  });

  it('should apply category-based styling for personal', () => {
    render(<RelationshipBadge type="friend" />);
    const badge = screen.getByTestId('relationship-badge');
    expect(badge).toHaveAttribute('data-category', 'personal');
  });

  it('should show strength indicator when provided', () => {
    render(<RelationshipBadge {...defaultProps} strength="strong" showStrength />);
    expect(screen.getByTestId('strength-indicator')).toBeInTheDocument();
  });

  it('should not show strength indicator by default', () => {
    render(<RelationshipBadge {...defaultProps} />);
    expect(screen.queryByTestId('strength-indicator')).not.toBeInTheDocument();
  });
});

describe('RelationshipCard', () => {
  const mockContact: Contact = {
    id: 'contact-1',
    name: 'Alice Smith',
    email: 'alice@example.com',
    avatar: 'https://example.com/alice.png',
  };

  const mockRelationship: ContactRelationship = {
    id: 'rel-1',
    contact_id: 'contact-1',
    relatedContactId: 'contact-2',
    type: 'colleague',
    strength: 'strong',
    direction: 'bidirectional',
    notes: 'Work together on Project X',
    lastInteraction: '2024-01-15',
  };

  const defaultProps: RelationshipCardProps = {
    relationship: mockRelationship,
    contact: mockContact,
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render contact name', () => {
    render(<RelationshipCard {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('should render relationship type badge', () => {
    render(<RelationshipCard {...defaultProps} />);
    expect(screen.getByText('Colleague')).toBeInTheDocument();
  });

  it('should show relationship notes', () => {
    render(<RelationshipCard {...defaultProps} />);
    expect(screen.getByText(/Work together on Project X/)).toBeInTheDocument();
  });

  it('should show last interaction date', () => {
    render(<RelationshipCard {...defaultProps} />);
    expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument();
  });

  it('should call onEdit when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<RelationshipCard {...defaultProps} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(onEdit).toHaveBeenCalledWith('rel-1');
  });

  it('should call onRemove when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<RelationshipCard {...defaultProps} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledWith('rel-1');
  });

  it('should show direction indicator for directional relationships', () => {
    const directionalRelationship = { ...mockRelationship, direction: 'outgoing' as const };
    render(<RelationshipCard {...defaultProps} relationship={directionalRelationship} />);
    expect(screen.getByTestId('direction-indicator')).toBeInTheDocument();
  });

  it('should show contact avatar', () => {
    render(<RelationshipCard {...defaultProps} />);
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('src', 'https://example.com/alice.png');
  });
});

describe('AddRelationshipDialog', () => {
  const mockContacts: Contact[] = [
    { id: 'contact-1', name: 'Alice Smith', email: 'alice@example.com' },
    { id: 'contact-2', name: 'Bob Jones', email: 'bob@example.com' },
    { id: 'contact-3', name: 'Carol White', email: 'carol@example.com' },
  ];

  const defaultProps: AddRelationshipDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    currentContactId: 'contact-1',
    availableContacts: mockContacts,
    onAddRelationship: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<AddRelationshipDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should show relationship type selector', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByText(/relationship type/i)).toBeInTheDocument();
  });

  it('should show contact selector', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByText(/select contact/i)).toBeInTheDocument();
  });

  it('should not show current contact in list', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    // Alice is currentContactId, should not appear in dropdown
    const options = screen.getAllByRole('option');
    const hasAlice = options.some((opt) => opt.textContent?.includes('Alice'));
    expect(hasAlice).toBe(false);
  });

  it('should show strength selector', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByText(/strength/i)).toBeInTheDocument();
  });

  it('should show direction selector', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByText(/direction/i)).toBeInTheDocument();
  });

  it('should show notes field', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('should call onAddRelationship when form submitted', async () => {
    const onAddRelationship = vi.fn();
    render(<AddRelationshipDialog {...defaultProps} onAddRelationship={onAddRelationship} />);

    // Select contact
    fireEvent.click(screen.getByText('Bob Jones'));

    // Select relationship type
    fireEvent.click(screen.getByText('Colleague'));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /add relationship/i }));

    await waitFor(() => {
      expect(onAddRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_id: 'contact-1',
          relatedContactId: 'contact-2',
          type: 'colleague',
        }),
      );
    });
  });

  it('should disable submit until contact selected', () => {
    render(<AddRelationshipDialog {...defaultProps} />);
    const submitButton = screen.getByRole('button', { name: /add relationship/i });
    expect(submitButton).toBeDisabled();
  });

  it('should close dialog on cancel', () => {
    const onOpenChange = vi.fn();
    render(<AddRelationshipDialog {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('RelationshipFilter', () => {
  const defaultProps: RelationshipFilterProps = {
    selectedTypes: [],
    selectedStrengths: [],
    onTypeChange: vi.fn(),
    onStrengthChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render type filter section', () => {
    render(<RelationshipFilter {...defaultProps} />);
    expect(screen.getByText(/relationship type/i)).toBeInTheDocument();
  });

  it('should render strength filter section', () => {
    render(<RelationshipFilter {...defaultProps} />);
    expect(screen.getByText(/strength/i)).toBeInTheDocument();
  });

  it('should show all relationship types grouped by category', () => {
    render(<RelationshipFilter {...defaultProps} />);
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('should call onTypeChange when type toggled', () => {
    const onTypeChange = vi.fn();
    render(<RelationshipFilter {...defaultProps} onTypeChange={onTypeChange} />);

    fireEvent.click(screen.getByText('Colleague'));

    expect(onTypeChange).toHaveBeenCalledWith(['colleague']);
  });

  it('should highlight selected types', () => {
    render(<RelationshipFilter {...defaultProps} selectedTypes={['colleague']} />);
    const colleagueBtn = screen.getByText('Colleague').closest('button');
    expect(colleagueBtn).toHaveAttribute('data-selected', 'true');
  });

  it('should call onStrengthChange when strength toggled', () => {
    const onStrengthChange = vi.fn();
    render(<RelationshipFilter {...defaultProps} onStrengthChange={onStrengthChange} />);

    fireEvent.click(screen.getByText('Strong'));

    expect(onStrengthChange).toHaveBeenCalledWith(['strong']);
  });

  it('should show clear filters button when filters active', () => {
    render(<RelationshipFilter {...defaultProps} selectedTypes={['colleague']} />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('should call clear handlers when clear clicked', () => {
    const onTypeChange = vi.fn();
    const onStrengthChange = vi.fn();
    render(<RelationshipFilter {...defaultProps} selectedTypes={['colleague']} onTypeChange={onTypeChange} onStrengthChange={onStrengthChange} />);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(onTypeChange).toHaveBeenCalledWith([]);
    expect(onStrengthChange).toHaveBeenCalledWith([]);
  });
});

describe('ContactRelationshipSection', () => {
  const mockContact: Contact = {
    id: 'contact-1',
    name: 'Alice Smith',
    email: 'alice@example.com',
  };

  const mockRelatedContacts: Contact[] = [
    { id: 'contact-2', name: 'Bob Jones', email: 'bob@example.com' },
    { id: 'contact-3', name: 'Carol White', email: 'carol@example.com' },
  ];

  const mockRelationships: ContactRelationship[] = [
    {
      id: 'rel-1',
      contact_id: 'contact-1',
      relatedContactId: 'contact-2',
      type: 'colleague',
      strength: 'strong',
      direction: 'bidirectional',
    },
    {
      id: 'rel-2',
      contact_id: 'contact-1',
      relatedContactId: 'contact-3',
      type: 'client',
      strength: 'medium',
      direction: 'outgoing',
    },
  ];

  const defaultProps: ContactRelationshipSectionProps = {
    contact_id: 'contact-1',
    relationships: mockRelationships,
    related_contacts: mockRelatedContacts,
    availableContacts: [...mockRelatedContacts],
    onAddRelationship: vi.fn(),
    onEditRelationship: vi.fn(),
    onRemoveRelationship: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render section title', () => {
    render(<ContactRelationshipSection {...defaultProps} />);
    expect(screen.getByText(/relationships/i)).toBeInTheDocument();
  });

  it('should render all relationships', () => {
    render(<ContactRelationshipSection {...defaultProps} />);
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol White')).toBeInTheDocument();
  });

  it('should show add relationship button', () => {
    render(<ContactRelationshipSection {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add relationship/i })).toBeInTheDocument();
  });

  it('should open add dialog when button clicked', () => {
    render(<ContactRelationshipSection {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /add relationship/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show empty state when no relationships', () => {
    render(<ContactRelationshipSection {...defaultProps} relationships={[]} />);
    expect(screen.getByText(/no relationships/i)).toBeInTheDocument();
  });

  it('should call onRemoveRelationship when relationship removed', () => {
    const onRemoveRelationship = vi.fn();
    render(<ContactRelationshipSection {...defaultProps} onRemoveRelationship={onRemoveRelationship} />);

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(onRemoveRelationship).toHaveBeenCalledWith('rel-1');
  });

  it('should show relationship count', () => {
    render(<ContactRelationshipSection {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should group relationships by category', () => {
    render(<ContactRelationshipSection {...defaultProps} />);
    expect(screen.getByText('Professional')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
  });
});

describe('relationship-utils', () => {
  describe('RELATIONSHIP_TYPES', () => {
    it('should include professional types', () => {
      expect(RELATIONSHIP_TYPES.professional).toContain('colleague');
      expect(RELATIONSHIP_TYPES.professional).toContain('manager');
      expect(RELATIONSHIP_TYPES.professional).toContain('direct_report');
      expect(RELATIONSHIP_TYPES.professional).toContain('mentor');
    });

    it('should include business types', () => {
      expect(RELATIONSHIP_TYPES.business).toContain('client');
      expect(RELATIONSHIP_TYPES.business).toContain('vendor');
      expect(RELATIONSHIP_TYPES.business).toContain('partner');
      expect(RELATIONSHIP_TYPES.business).toContain('investor');
      expect(RELATIONSHIP_TYPES.business).toContain('advisor');
    });

    it('should include personal types', () => {
      expect(RELATIONSHIP_TYPES.personal).toContain('friend');
      expect(RELATIONSHIP_TYPES.personal).toContain('family');
      expect(RELATIONSHIP_TYPES.personal).toContain('acquaintance');
    });
  });

  describe('getRelationshipLabel', () => {
    it('should return human-readable label for type', () => {
      expect(getRelationshipLabel('colleague')).toBe('Colleague');
      expect(getRelationshipLabel('direct_report')).toBe('Direct Report');
      expect(getRelationshipLabel('client')).toBe('Client');
    });
  });

  describe('getRelationshipCategory', () => {
    it('should return category for relationship type', () => {
      expect(getRelationshipCategory('colleague')).toBe('professional');
      expect(getRelationshipCategory('client')).toBe('business');
      expect(getRelationshipCategory('friend')).toBe('personal');
    });
  });
});
