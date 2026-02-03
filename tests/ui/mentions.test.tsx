/**
 * @vitest-environment jsdom
 * Tests for @mention support with notifications
 * Issue #400: Implement @mention support with notifications
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  MentionAutocomplete,
  type MentionAutocompleteProps,
} from '@/ui/components/mentions/mention-autocomplete';
import {
  MentionBadge,
  type MentionBadgeProps,
} from '@/ui/components/mentions/mention-badge';
import {
  MentionInput,
  type MentionInputProps,
} from '@/ui/components/mentions/mention-input';
import {
  MentionList,
  type MentionListProps,
} from '@/ui/components/mentions/mention-list';
import {
  parseMentions,
  extractMentionIds,
  serializeMentions,
  createMentionToken,
  type Mention,
  type MentionUser,
} from '@/ui/components/mentions/mention-utils';

describe('MentionAutocomplete', () => {
  const mockUsers: MentionUser[] = [
    { id: 'user-1', name: 'Alice Smith', avatar: 'https://example.com/alice.png' },
    { id: 'user-2', name: 'Bob Jones', avatar: 'https://example.com/bob.png' },
    { id: 'user-3', name: 'Charlie Brown' },
  ];

  const defaultProps: MentionAutocompleteProps = {
    users: mockUsers,
    onSelect: vi.fn(),
    query: '',
    visible: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render user list when visible', () => {
    render(<MentionAutocomplete {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('should not render when not visible', () => {
    render(<MentionAutocomplete {...defaultProps} visible={false} />);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('should filter users by query', () => {
    render(<MentionAutocomplete {...defaultProps} query="alice" />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });

  it('should show avatars when available', () => {
    render(<MentionAutocomplete {...defaultProps} />);
    const avatars = screen.getAllByRole('img');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
  });

  it('should show initials when no avatar', () => {
    render(<MentionAutocomplete {...defaultProps} />);
    expect(screen.getByText('CB')).toBeInTheDocument(); // Charlie Brown initials
  });

  it('should highlight first item by default', () => {
    render(<MentionAutocomplete {...defaultProps} />);
    const firstItem = screen.getByTestId('mention-option-0');
    expect(firstItem).toHaveAttribute('data-highlighted', 'true');
  });

  it('should call onSelect when item clicked', () => {
    const onSelect = vi.fn();
    render(<MentionAutocomplete {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Bob Jones'));

    expect(onSelect).toHaveBeenCalledWith(mockUsers[1]);
  });

  it('should show no results message when no matches', () => {
    render(<MentionAutocomplete {...defaultProps} query="xyz" />);
    expect(screen.getByText(/no users found/i)).toBeInTheDocument();
  });

  it('should support keyboard navigation', () => {
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    render(
      <MentionAutocomplete
        {...defaultProps}
        onSelect={onSelect}
        onNavigate={onNavigate}
        highlightedIndex={1}
      />
    );

    const secondItem = screen.getByTestId('mention-option-1');
    expect(secondItem).toHaveAttribute('data-highlighted', 'true');
  });

  it('should show loading state', () => {
    render(<MentionAutocomplete {...defaultProps} loading />);
    expect(screen.getByTestId('mention-loading')).toBeInTheDocument();
  });
});

describe('MentionBadge', () => {
  const mockMention: Mention = {
    id: 'user-1',
    name: 'Alice Smith',
    type: 'user',
  };

  const defaultProps: MentionBadgeProps = {
    mention: mockMention,
  };

  it('should render mention name with @ prefix', () => {
    render(<MentionBadge {...defaultProps} />);
    expect(screen.getByText('@Alice Smith')).toBeInTheDocument();
  });

  it('should apply mention styling', () => {
    render(<MentionBadge {...defaultProps} />);
    const badge = screen.getByText('@Alice Smith');
    expect(badge).toHaveClass('bg-primary/10');
  });

  it('should be clickable when onClick provided', () => {
    const onClick = vi.fn();
    render(<MentionBadge {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByText('@Alice Smith'));

    expect(onClick).toHaveBeenCalledWith(mockMention);
  });

  it('should show as link when href provided', () => {
    render(<MentionBadge {...defaultProps} href="/contacts/user-1" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/contacts/user-1');
  });

  it('should support different mention types', () => {
    const teamMention: Mention = { id: 'team-1', name: 'Engineering', type: 'team' };
    render(<MentionBadge mention={teamMention} />);
    expect(screen.getByText('@Engineering')).toBeInTheDocument();
  });
});

describe('MentionInput', () => {
  const mockUsers: MentionUser[] = [
    { id: 'user-1', name: 'Alice Smith' },
    { id: 'user-2', name: 'Bob Jones' },
  ];

  const defaultProps: MentionInputProps = {
    users: mockUsers,
    value: '',
    onChange: vi.fn(),
    placeholder: 'Type @ to mention someone...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render textarea with placeholder', () => {
    render(<MentionInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Type @ to mention someone...')).toBeInTheDocument();
  });

  it('should show autocomplete when @ typed', async () => {
    render(<MentionInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('should filter autocomplete based on text after @', async () => {
    render(<MentionInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@ali' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });
  });

  it('should insert mention when user selected', async () => {
    const onChange = vi.fn();
    render(<MentionInput {...defaultProps} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@ali' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Alice Smith'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('should close autocomplete when escape pressed', async () => {
    render(<MentionInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });
  });

  it('should navigate autocomplete with arrow keys', async () => {
    render(<MentionInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    const secondItem = screen.getByTestId('mention-option-1');
    expect(secondItem).toHaveAttribute('data-highlighted', 'true');
  });

  it('should select with Enter key', async () => {
    const onChange = vi.fn();
    render(<MentionInput {...defaultProps} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: '@' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('should render existing mentions in value', () => {
    const valueWithMention = 'Hello @[Alice Smith](user:user-1), how are you?';
    render(<MentionInput {...defaultProps} value={valueWithMention} />);

    // The input should show the value
    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    expect(textarea).toHaveValue(valueWithMention);
  });

  it('should support multiple mentions', async () => {
    const onChange = vi.fn();
    const value = 'Hey @[Alice Smith](user:user-1), ';
    render(<MentionInput {...defaultProps} value={value} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText('Type @ to mention someone...');
    fireEvent.change(textarea, { target: { value: value + '@bob' } });

    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });
  });
});

describe('MentionList', () => {
  const mockMentions: Mention[] = [
    { id: 'user-1', name: 'Alice Smith', type: 'user' },
    { id: 'user-2', name: 'Bob Jones', type: 'user' },
    { id: 'team-1', name: 'Engineering', type: 'team' },
  ];

  const defaultProps: MentionListProps = {
    mentions: mockMentions,
  };

  it('should render all mentions', () => {
    render(<MentionList {...defaultProps} />);
    expect(screen.getByText('@Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('@Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('@Engineering')).toBeInTheDocument();
  });

  it('should show empty message when no mentions', () => {
    render(<MentionList mentions={[]} />);
    expect(screen.getByText(/no mentions/i)).toBeInTheDocument();
  });

  it('should group mentions by type', () => {
    render(<MentionList {...defaultProps} groupByType />);
    expect(screen.getByText(/users/i)).toBeInTheDocument();
    expect(screen.getByText(/teams/i)).toBeInTheDocument();
  });

  it('should call onMentionClick when mention clicked', () => {
    const onMentionClick = vi.fn();
    render(<MentionList {...defaultProps} onMentionClick={onMentionClick} />);

    fireEvent.click(screen.getByText('@Alice Smith'));

    expect(onMentionClick).toHaveBeenCalledWith(mockMentions[0]);
  });
});

describe('Mention Utilities', () => {
  describe('parseMentions', () => {
    it('should parse mention tokens from text', () => {
      const text = 'Hello @[Alice Smith](user:user-1), how are you?';
      const result = parseMentions(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'user-1',
        name: 'Alice Smith',
        type: 'user',
      });
    });

    it('should parse multiple mentions', () => {
      const text = 'Hey @[Alice](user:user-1) and @[Bob](user:user-2)!';
      const result = parseMentions(text);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-2');
    });

    it('should return empty array for no mentions', () => {
      const text = 'Hello world, no mentions here!';
      const result = parseMentions(text);

      expect(result).toHaveLength(0);
    });

    it('should handle team mentions', () => {
      const text = 'Attention @[Engineering](team:team-1)!';
      const result = parseMentions(text);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('team');
    });
  });

  describe('extractMentionIds', () => {
    it('should extract just the IDs from text', () => {
      const text = 'Hey @[Alice](user:user-1) and @[Bob](user:user-2)!';
      const ids = extractMentionIds(text);

      expect(ids).toEqual(['user-1', 'user-2']);
    });

    it('should return unique IDs', () => {
      const text = '@[Alice](user:user-1) says hi to @[Alice](user:user-1)';
      const ids = extractMentionIds(text);

      expect(ids).toEqual(['user-1']);
    });
  });

  describe('serializeMentions', () => {
    it('should convert mentions array to token string', () => {
      const mentions: Mention[] = [
        { id: 'user-1', name: 'Alice', type: 'user' },
      ];

      const result = serializeMentions('Hello ', mentions[0], '!');

      expect(result).toBe('Hello @[Alice](user:user-1)!');
    });
  });

  describe('createMentionToken', () => {
    it('should create mention token from user', () => {
      const user: MentionUser = { id: 'user-1', name: 'Alice Smith' };
      const token = createMentionToken(user);

      expect(token).toBe('@[Alice Smith](user:user-1)');
    });

    it('should handle names with special characters', () => {
      const user: MentionUser = { id: 'user-1', name: "Alice O'Brien" };
      const token = createMentionToken(user);

      expect(token).toBe("@[Alice O'Brien](user:user-1)");
    });
  });
});
