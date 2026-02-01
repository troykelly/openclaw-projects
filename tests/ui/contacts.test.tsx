/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ContactCard,
  ContactList,
  ContactDetailSheet,
  ContactForm,
  type Contact,
  type ContactDetail,
} from '@/ui/components/contacts';

const mockContact: Contact = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  company: 'Acme Corp',
  role: 'Product Manager',
  linkedItemCount: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockContacts: Contact[] = [
  mockContact,
  {
    id: '2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    company: 'Tech Inc',
    role: 'Engineer',
    linkedItemCount: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockDetailContact: ContactDetail = {
  ...mockContact,
  phone: '+1 555-1234',
  notes: 'Key stakeholder',
  linkedWorkItems: [
    { id: 'wi-1', title: 'Project Alpha', kind: 'project', status: 'active', relationship: 'owner' },
    { id: 'wi-2', title: 'Bug Fix', kind: 'issue', status: 'open', relationship: 'assignee' },
  ],
  linkedCommunications: [
    { id: 'c-1', type: 'email', subject: 'Project Update', date: new Date(), direction: 'sent' },
    { id: 'c-2', type: 'calendar', subject: 'Weekly Sync', date: new Date() },
  ],
};

describe('ContactCard', () => {
  it('renders contact name and email', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('renders company and role', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Product Manager')).toBeInTheDocument();
  });

  it('shows linked item count', () => {
    render(<ContactCard contact={mockContact} />);

    expect(screen.getByText('5 linked')).toBeInTheDocument();
  });

  it('shows initials when no avatar', () => {
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
    render(
      <ContactDetailSheet
        contact={mockDetailContact}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('Key stakeholder')).toBeInTheDocument();
  });

  it('shows linked work items', () => {
    render(
      <ContactDetailSheet
        contact={mockDetailContact}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bug Fix')).toBeInTheDocument();
  });

  it('shows linked communications', () => {
    render(
      <ContactDetailSheet
        contact={mockDetailContact}
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(screen.getByText('Project Update')).toBeInTheDocument();
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument();
  });

  it('calls onEdit when edit clicked', () => {
    const onEdit = vi.fn();
    render(
      <ContactDetailSheet
        contact={mockDetailContact}
        open={true}
        onOpenChange={() => {}}
        onEdit={onEdit}
      />
    );

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(mockDetailContact);
  });

  it('calls onWorkItemClick when item clicked', () => {
    const onWorkItemClick = vi.fn();
    render(
      <ContactDetailSheet
        contact={mockDetailContact}
        open={true}
        onOpenChange={() => {}}
        onWorkItemClick={onWorkItemClick}
      />
    );

    fireEvent.click(screen.getByText('Project Alpha'));
    expect(onWorkItemClick).toHaveBeenCalledWith(mockDetailContact.linkedWorkItems[0]);
  });
});

describe('ContactForm', () => {
  it('renders form fields', () => {
    render(
      <ContactForm
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Company/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Role/)).toBeInTheDocument();
  });

  it('pre-fills form when editing', () => {
    render(
      <ContactForm
        contact={mockContact}
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('john@example.com')).toBeInTheDocument();
  });

  it('submits form data', () => {
    const onSubmit = vi.fn();
    render(
      <ContactForm
        open={true}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'test@test.com' } });
    // Find submit button by role instead of text (there may be multiple elements)
    const submitButton = screen.getByRole('button', { name: 'Add Contact' });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test User',
      email: 'test@test.com',
    }));
  });

  it('disables submit when required fields empty', () => {
    render(
      <ContactForm
        open={true}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const submitButton = screen.getByRole('button', { name: 'Add Contact' });
    expect(submitButton).toBeDisabled();
  });
});
