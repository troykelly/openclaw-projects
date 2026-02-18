/**
 * @vitest-environment jsdom
 * Tests for contact groups and organization components
 * Issue #394: Implement contact groups and organization hierarchy
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { OrganizationCard, type OrganizationCardProps } from '@/ui/components/organizations/organization-card';
import { ContactGroupBadge, type ContactGroupBadgeProps } from '@/ui/components/organizations/contact-group-badge';
import { ContactGroupManager, type ContactGroupManagerProps } from '@/ui/components/organizations/contact-group-manager';
import { OrganizationFilter, type OrganizationFilterProps } from '@/ui/components/organizations/organization-filter';
import type { Organization, ContactGroup, ContactRelationship } from '@/ui/components/organizations/types';

describe('OrganizationCard', () => {
  const defaultProps: OrganizationCardProps = {
    organization: {
      id: 'org-1',
      name: 'Acme Corp',
      domain: 'acme.com',
      description: 'Leading technology company',
      contactCount: 15,
    },
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render organization name', () => {
    render(<OrganizationCard {...defaultProps} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('should show domain if provided', () => {
    render(<OrganizationCard {...defaultProps} />);
    expect(screen.getByText('acme.com')).toBeInTheDocument();
  });

  it('should show contact count', () => {
    render(<OrganizationCard {...defaultProps} />);
    expect(screen.getByText(/15.*contacts/i)).toBeInTheDocument();
  });

  it('should show description', () => {
    render(<OrganizationCard {...defaultProps} />);
    expect(screen.getByText(/leading technology/i)).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<OrganizationCard {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByText('Acme Corp'));

    expect(onClick).toHaveBeenCalledWith('org-1');
  });

  it('should show logo if provided', () => {
    render(<OrganizationCard {...defaultProps} organization={{ ...defaultProps.organization, logo: 'https://acme.com/logo.png' }} />);
    const logo = screen.getByRole('img');
    expect(logo).toHaveAttribute('src', 'https://acme.com/logo.png');
  });

  it('should show placeholder when no logo', () => {
    render(<OrganizationCard {...defaultProps} />);
    expect(screen.getByTestId('org-logo-placeholder')).toBeInTheDocument();
  });
});

describe('ContactGroupBadge', () => {
  const defaultProps: ContactGroupBadgeProps = {
    group: {
      id: 'group-1',
      name: 'VIP Clients',
      color: '#4f46e5',
      memberCount: 8,
    },
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render group name', () => {
    render(<ContactGroupBadge {...defaultProps} />);
    expect(screen.getByText('VIP Clients')).toBeInTheDocument();
  });

  it('should apply group color', () => {
    render(<ContactGroupBadge {...defaultProps} />);
    const badge = screen.getByTestId('contact-group-badge');
    expect(badge).toHaveStyle({ backgroundColor: '#4f46e5' });
  });

  it('should show remove button when removable', () => {
    render(<ContactGroupBadge {...defaultProps} removable />);
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('should not show remove button when not removable', () => {
    render(<ContactGroupBadge {...defaultProps} removable={false} />);
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('should call onRemove when remove clicked', () => {
    const onRemove = vi.fn();
    render(<ContactGroupBadge {...defaultProps} onRemove={onRemove} removable />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledWith('group-1');
  });

  it('should show member count when enabled', () => {
    render(<ContactGroupBadge {...defaultProps} showCount />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});

describe('ContactGroupManager', () => {
  const mockGroups: ContactGroup[] = [
    { id: 'group-1', name: 'VIP Clients', color: '#4f46e5', memberCount: 8 },
    { id: 'group-2', name: 'Engineering Team', color: '#10b981', memberCount: 12 },
    { id: 'group-3', name: 'Partners', color: '#f59e0b', memberCount: 5 },
  ];

  const defaultProps: ContactGroupManagerProps = {
    contact_id: 'contact-1',
    assignedGroups: [mockGroups[0]],
    availableGroups: mockGroups,
    onAddToGroup: vi.fn(),
    onRemoveFromGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render assigned groups', () => {
    render(<ContactGroupManager {...defaultProps} />);
    expect(screen.getByText('VIP Clients')).toBeInTheDocument();
  });

  it('should show add group button', () => {
    render(<ContactGroupManager {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add.*group/i })).toBeInTheDocument();
  });

  it('should show available groups in dropdown', async () => {
    render(<ContactGroupManager {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: /add.*group/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      // Should show unassigned groups
      expect(screen.getByText('Engineering Team')).toBeInTheDocument();
      expect(screen.getByText('Partners')).toBeInTheDocument();
    });
  });

  it('should not show already assigned groups in dropdown', async () => {
    render(<ContactGroupManager {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: /add.*group/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      // VIP Clients is assigned, should not be in dropdown
      const dropdownItems = screen.getAllByRole('option');
      const hasVIP = dropdownItems.some((item) => item.textContent?.includes('VIP Clients'));
      expect(hasVIP).toBe(false);
    });
  });

  it('should call onAddToGroup when group selected', async () => {
    const onAddToGroup = vi.fn();
    render(<ContactGroupManager {...defaultProps} onAddToGroup={onAddToGroup} />);

    const addButton = screen.getByRole('button', { name: /add.*group/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      const engineeringOption = screen.getByText('Engineering Team');
      fireEvent.click(engineeringOption);
    });

    expect(onAddToGroup).toHaveBeenCalledWith('contact-1', 'group-2');
  });

  it('should call onRemoveFromGroup when badge removed', () => {
    const onRemoveFromGroup = vi.fn();
    render(<ContactGroupManager {...defaultProps} onRemoveFromGroup={onRemoveFromGroup} />);

    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    expect(onRemoveFromGroup).toHaveBeenCalledWith('contact-1', 'group-1');
  });
});

describe('OrganizationFilter', () => {
  const mockOrganizations: Organization[] = [
    { id: 'org-1', name: 'Acme Corp', contactCount: 15 },
    { id: 'org-2', name: 'Tech Inc', contactCount: 8 },
    { id: 'org-3', name: 'Startup LLC', contactCount: 3 },
  ];

  const mockGroups: ContactGroup[] = [
    { id: 'group-1', name: 'VIP Clients', color: '#4f46e5', memberCount: 8 },
    { id: 'group-2', name: 'Engineering Team', color: '#10b981', memberCount: 12 },
  ];

  const defaultProps: OrganizationFilterProps = {
    organizations: mockOrganizations,
    groups: mockGroups,
    selectedOrganizationId: null,
    selectedGroupId: null,
    onOrganizationChange: vi.fn(),
    onGroupChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render organization filter', () => {
    render(<OrganizationFilter {...defaultProps} />);
    // "Organization" label appears, along with "All Organizations" option
    expect(screen.getByText('All Organizations')).toBeInTheDocument();
  });

  it('should render group filter', () => {
    render(<OrganizationFilter {...defaultProps} />);
    // "Group" label appears, along with "All Groups" option
    expect(screen.getByText('All Groups')).toBeInTheDocument();
  });

  it('should show all organizations option', () => {
    render(<OrganizationFilter {...defaultProps} />);
    expect(screen.getByText(/all organizations/i)).toBeInTheDocument();
  });

  it('should list all organizations', () => {
    render(<OrganizationFilter {...defaultProps} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Tech Inc')).toBeInTheDocument();
  });

  it('should call onOrganizationChange when org selected', () => {
    const onOrganizationChange = vi.fn();
    render(<OrganizationFilter {...defaultProps} onOrganizationChange={onOrganizationChange} />);

    fireEvent.click(screen.getByText('Acme Corp'));

    expect(onOrganizationChange).toHaveBeenCalledWith('org-1');
  });

  it('should highlight selected organization', () => {
    render(<OrganizationFilter {...defaultProps} selectedOrganizationId="org-1" />);
    const acmeButton = screen.getByText('Acme Corp').closest('button');
    expect(acmeButton).toHaveAttribute('data-selected', 'true');
  });

  it('should call onGroupChange when group selected', () => {
    const onGroupChange = vi.fn();
    render(<OrganizationFilter {...defaultProps} onGroupChange={onGroupChange} />);

    fireEvent.click(screen.getByText('VIP Clients'));

    expect(onGroupChange).toHaveBeenCalledWith('group-1');
  });

  it('should show contact counts for organizations', () => {
    render(<OrganizationFilter {...defaultProps} />);
    expect(screen.getByText('15')).toBeInTheDocument(); // Acme Corp count
  });
});

describe('Integration', () => {
  it('should support filtering contacts by organization and group', () => {
    // This is a conceptual test documenting expected behavior
    const contacts = [
      { id: '1', name: 'Alice', organizationId: 'org-1', groups: ['group-1'] },
      { id: '2', name: 'Bob', organizationId: 'org-1', groups: ['group-2'] },
      { id: '3', name: 'Charlie', organizationId: 'org-2', groups: ['group-1'] },
    ];

    // Filter by organization
    const orgFiltered = contacts.filter((c) => c.organizationId === 'org-1');
    expect(orgFiltered).toHaveLength(2);

    // Filter by group
    const groupFiltered = contacts.filter((c) => c.groups.includes('group-1'));
    expect(groupFiltered).toHaveLength(2);

    // Filter by both
    const bothFiltered = contacts.filter((c) => c.organizationId === 'org-1' && c.groups.includes('group-1'));
    expect(bothFiltered).toHaveLength(1);
  });
});
