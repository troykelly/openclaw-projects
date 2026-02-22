/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContactCard, ContactList, ContactDetailSheet, ContactForm, type Contact } from '@/ui/components/contacts';
import type { LinkedWorkItem, LinkedCommunication } from '@/ui/components/contacts';

const mockContact: Contact = {
  id: '1',
  display_name: 'John Doe',
  given_name: 'John',
  family_name: 'Doe',
  contact_kind: 'person',
  endpoints: [
    { id: 'ep-1', type: 'email', value: 'john@example.com' },
    { id: 'ep-2', type: 'phone', value: '+1 555-1234' },
  ],
  tags: ['vip', 'client'],
  notes: 'Key stakeholder',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockContacts: Contact[] = [
  mockContact,
  {
    id: '2',
    display_name: 'Jane Smith',
    given_name: 'Jane',
    family_name: 'Smith',
    contact_kind: 'person',
    endpoints: [
      { id: 'ep-3', type: 'email', value: 'jane@example.com' },
    ],
    tags: ['partner'],
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

const mockLinkedWorkItems: LinkedWorkItem[] = [
  { id: 'wi-1', title: 'Project Alpha', kind: 'project', status: 'active', relationship: 'owner' },
  { id: 'wi-2', title: 'Bug Fix', kind: 'issue', status: 'open', relationship: 'assignee' },
];

const mockLinkedCommunications: LinkedCommunication[] = [
  { id: 'c-1', type: 'email', subject: 'Project Update', date: new Date(), direction: 'sent' },
  { id: 'c-2', type: 'calendar', subject: 'Weekly Sync', date: new Date() },
];

describe('ContactCard', () => {
  it('renders contact name and email', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('renders tags', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('vip')).toBeInTheDocument();
    expect(screen.getByText('client')).toBeInTheDocument();
  });

  it('shows initials when no photo', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ContactCard contact={mockContact} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('contact-card'));
    expect(onClick).toHaveBeenCalledWith(mockContact);
  });
});

describe('ContactList', () => {
  it('renders all contacts', () => {
    render(<ContactList contacts={mockContacts} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('filters contacts by search', () => {
    render(<ContactList contacts={mockContacts} />);

    const searchInput = screen.getByPlaceholderText('Search contacts...');
    fireEvent.change(searchInput, { target: { value: 'Jane' } });

    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('shows empty state when no contacts', () => {
    render(<ContactList contacts={[]} />);

    expect(screen.getByText('No contacts yet')).toBeInTheDocument();
  });

  it('shows no results message when search has no matches', () => {
    render(<ContactList contacts={mockContacts} />);

    const searchInput = screen.getByPlaceholderText('Search contacts...');
    fireEvent.change(searchInput, { target: { value: 'xyz' } });

    expect(screen.getByText('No contacts found')).toBeInTheDocument();
  });

  it('shows add button when onAddContact provided', () => {
    const onAddContact = vi.fn();
    render(<ContactList contacts={mockContacts} onAddContact={onAddContact} />);

    expect(screen.getByText('Add Contact')).toBeInTheDocument();
  });

  it('calls onContactClick when contact clicked', () => {
    const onContactClick = vi.fn();
    render(<ContactList contacts={mockContacts} onContactClick={onContactClick} />);

    fireEvent.click(screen.getByText('John Doe'));
    expect(onContactClick).toHaveBeenCalledWith(mockContacts[0]);
  });
});

describe('ContactDetailSheet', () => {
  it('renders contact details', () => {
    render(<ContactDetailSheet contact={mockContact} open={true} onOpenChange={() => {}} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('Key stakeholder')).toBeInTheDocument();
  });

  it('shows linked work items', () => {
    render(
      <ContactDetailSheet
        contact={mockContact}
        open={true}
        onOpenChange={() => {}}
        linkedWorkItems={mockLinkedWorkItems}
      />,
    );

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bug Fix')).toBeInTheDocument();
  });

  it('shows linked communications', () => {
    render(
      <ContactDetailSheet
        contact={mockContact}
        open={true}
        onOpenChange={() => {}}
        linkedCommunications={mockLinkedCommunications}
      />,
    );

    expect(screen.getByText('Project Update')).toBeInTheDocument();
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument();
  });

  it('calls onEdit when edit clicked', () => {
    const onEdit = vi.fn();
    render(<ContactDetailSheet contact={mockContact} open={true} onOpenChange={() => {}} onEdit={onEdit} />);

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(mockContact);
  });

  it('calls onWorkItemClick when item clicked', () => {
    const onWorkItemClick = vi.fn();
    render(
      <ContactDetailSheet
        contact={mockContact}
        open={true}
        onOpenChange={() => {}}
        linkedWorkItems={mockLinkedWorkItems}
        onWorkItemClick={onWorkItemClick}
      />,
    );

    fireEvent.click(screen.getByText('Project Alpha'));
    expect(onWorkItemClick).toHaveBeenCalledWith(mockLinkedWorkItems[0]);
  });
});

describe('ContactForm', () => {
  it('renders form fields for person', () => {
    render(<ContactForm open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    expect(screen.getByLabelText(/Given Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Family Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nickname/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Phone/)).toBeInTheDocument();
  });

  it('pre-fills form when editing', () => {
    render(<ContactForm contact={mockContact} open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('john@example.com')).toBeInTheDocument();
  });

  it('submits form data with structured names', () => {
    const onSubmit = vi.fn();
    render(<ContactForm open={true} onOpenChange={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Given Name/), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Family Name/), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'test@test.com' } });

    const submitButton = screen.getByRole('button', { name: 'Add Contact' });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        given_name: 'Test',
        family_name: 'User',
        contact_kind: 'person',
      }),
    );
  });

  it('disables submit when required fields empty', () => {
    render(<ContactForm open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    const submitButton = screen.getByRole('button', { name: 'Add Contact' });
    expect(submitButton).toBeDisabled();
  });
});
