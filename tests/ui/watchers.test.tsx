/**
 * @vitest-environment jsdom
 * Tests for watchers/followers on work items
 * Issue #401: Implement watchers/followers on work items
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { WatchButton, type WatchButtonProps } from '@/ui/components/watchers/watch-button';
import { WatcherList, type WatcherListProps } from '@/ui/components/watchers/watcher-list';
import { AddWatcherDialog, type AddWatcherDialogProps } from '@/ui/components/watchers/add-watcher-dialog';
import { WatchedItemsList, type WatchedItemsListProps } from '@/ui/components/watchers/watched-items-list';
import { WatcherSettings, type WatcherSettingsProps } from '@/ui/components/watchers/watcher-settings';
import type { Watcher, WatchedItem, NotificationLevel, AutoWatchSettings } from '@/ui/components/watchers/types';

describe('WatchButton', () => {
  const defaultProps: WatchButtonProps = {
    isWatching: false,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show Watch text when not watching', () => {
    render(<WatchButton {...defaultProps} />);
    expect(screen.getByRole('button', { name: /watch/i })).toBeInTheDocument();
  });

  it('should show Watching text when watching', () => {
    render(<WatchButton {...defaultProps} isWatching />);
    expect(screen.getByRole('button', { name: /watching/i })).toBeInTheDocument();
  });

  it('should show eye icon', () => {
    render(<WatchButton {...defaultProps} />);
    expect(screen.getByTestId('watch-icon')).toBeInTheDocument();
  });

  it('should call onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<WatchButton {...defaultProps} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalled();
  });

  it('should show loading state', () => {
    render(<WatchButton {...defaultProps} loading />);
    expect(screen.getByTestId('watch-loading')).toBeInTheDocument();
  });

  it('should be disabled when loading', () => {
    render(<WatchButton {...defaultProps} loading />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('should show watcher count when provided', () => {
    render(<WatchButton {...defaultProps} watcherCount={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should support compact mode', () => {
    render(<WatchButton {...defaultProps} compact />);
    // In compact mode, don't show text, just icon
    expect(screen.queryByText(/watch/i)).not.toBeInTheDocument();
  });
});

describe('WatcherList', () => {
  const mockWatchers: Watcher[] = [
    {
      id: 'watcher-1',
      user_id: 'user-1',
      name: 'Alice Smith',
      avatar: 'https://example.com/alice.png',
      notificationLevel: 'all',
      addedAt: new Date().toISOString(),
    },
    {
      id: 'watcher-2',
      user_id: 'user-2',
      name: 'Bob Jones',
      notificationLevel: 'mentions',
      addedAt: new Date().toISOString(),
    },
  ];

  const defaultProps: WatcherListProps = {
    watchers: mockWatchers,
    currentUserId: 'user-3',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all watchers', () => {
    render(<WatcherList {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('should show watcher count', () => {
    render(<WatcherList {...defaultProps} />);
    expect(screen.getByText(/2 watchers/i)).toBeInTheDocument();
  });

  it('should show avatar when available', () => {
    render(<WatcherList {...defaultProps} />);
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('src', 'https://example.com/alice.png');
  });

  it('should show initials when no avatar', () => {
    render(<WatcherList {...defaultProps} />);
    expect(screen.getByText('BJ')).toBeInTheDocument(); // Bob Jones initials
  });

  it('should show notification level badge', () => {
    render(<WatcherList {...defaultProps} />);
    expect(screen.getByText(/all activity/i)).toBeInTheDocument();
    expect(screen.getByText(/mentions only/i)).toBeInTheDocument();
  });

  it('should show remove button for own entry', () => {
    render(<WatcherList {...defaultProps} currentUserId="user-1" onRemove={vi.fn()} />);
    const removeButtons = screen.getAllByLabelText(/remove watcher/i);
    expect(removeButtons.length).toBe(1);
  });

  it('should show remove button for owners', () => {
    render(<WatcherList {...defaultProps} isOwner onRemove={vi.fn()} />);
    const removeButtons = screen.getAllByLabelText(/remove watcher/i);
    expect(removeButtons.length).toBe(2);
  });

  it('should call onRemove when remove clicked', () => {
    const onRemove = vi.fn();
    render(<WatcherList {...defaultProps} isOwner onRemove={onRemove} />);

    const removeButtons = screen.getAllByRole('button', { name: /remove|unwatch/i });
    fireEvent.click(removeButtons[0]);

    expect(onRemove).toHaveBeenCalledWith('watcher-1');
  });

  it('should show add watcher button for owners', () => {
    render(<WatcherList {...defaultProps} isOwner onAddWatcher={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add watcher/i })).toBeInTheDocument();
  });

  it('should show empty state when no watchers', () => {
    render(<WatcherList watchers={[]} currentUserId="user-1" />);
    expect(screen.getByText(/no watchers/i)).toBeInTheDocument();
  });
});

describe('AddWatcherDialog', () => {
  const mockUsers = [
    { id: 'user-1', name: 'Alice Smith', avatar: 'https://example.com/alice.png' },
    { id: 'user-2', name: 'Bob Jones' },
    { id: 'user-3', name: 'Charlie Brown' },
  ];

  const defaultProps: AddWatcherDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    users: mockUsers,
    existingWatcherIds: ['user-3'],
    onAdd: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<AddWatcherDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show available users', () => {
    render(<AddWatcherDialog {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('should exclude existing watchers', () => {
    render(<AddWatcherDialog {...defaultProps} />);
    // Charlie Brown is already a watcher
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
  });

  it('should support search', () => {
    render(<AddWatcherDialog {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });

  it('should call onAdd when user selected', () => {
    const onAdd = vi.fn();
    render(<AddWatcherDialog {...defaultProps} onAdd={onAdd} />);

    fireEvent.click(screen.getByText('Alice Smith'));

    expect(onAdd).toHaveBeenCalledWith('user-1', 'all');
  });

  it('should allow selecting notification level', () => {
    render(<AddWatcherDialog {...defaultProps} />);
    expect(screen.getByText(/notification level/i)).toBeInTheDocument();
  });

  it('should close when cancel clicked', () => {
    const onOpenChange = vi.fn();
    render(<AddWatcherDialog {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('WatchedItemsList', () => {
  const mockItems: WatchedItem[] = [
    {
      id: 'wi-1',
      title: 'Fix login bug',
      type: 'issue',
      status: 'in_progress',
      notificationLevel: 'all',
      lastActivity: new Date().toISOString(),
      unread_count: 2,
    },
    {
      id: 'wi-2',
      title: 'Add user dashboard',
      type: 'task',
      status: 'open',
      notificationLevel: 'mentions',
      lastActivity: new Date(Date.now() - 86400000).toISOString(),
      unread_count: 0,
    },
  ];

  const defaultProps: WatchedItemsListProps = {
    items: mockItems,
    onItemClick: vi.fn(),
    onUnwatch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all watched items', () => {
    render(<WatchedItemsList {...defaultProps} />);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('Add user dashboard')).toBeInTheDocument();
  });

  it('should show item type', () => {
    render(<WatchedItemsList {...defaultProps} />);
    expect(screen.getByText(/issue/i)).toBeInTheDocument();
    expect(screen.getByText(/task/i)).toBeInTheDocument();
  });

  it('should show item status', () => {
    render(<WatchedItemsList {...defaultProps} />);
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/open/i)).toBeInTheDocument();
  });

  it('should show unread count badge', () => {
    render(<WatchedItemsList {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should show notification level', () => {
    render(<WatchedItemsList {...defaultProps} />);
    expect(screen.getByText(/all activity/i)).toBeInTheDocument();
    expect(screen.getByText(/mentions only/i)).toBeInTheDocument();
  });

  it('should call onItemClick when item clicked', () => {
    const onItemClick = vi.fn();
    render(<WatchedItemsList {...defaultProps} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Fix login bug'));

    expect(onItemClick).toHaveBeenCalledWith('wi-1');
  });

  it('should call onUnwatch when unwatch clicked', () => {
    const onUnwatch = vi.fn();
    render(<WatchedItemsList {...defaultProps} onUnwatch={onUnwatch} />);

    const unwatchButtons = screen.getAllByRole('button', { name: /unwatch/i });
    fireEvent.click(unwatchButtons[0]);

    expect(onUnwatch).toHaveBeenCalledWith('wi-1');
  });

  it('should show empty state when no items', () => {
    render(<WatchedItemsList items={[]} onItemClick={vi.fn()} onUnwatch={vi.fn()} />);
    expect(screen.getByText(/no watched items/i)).toBeInTheDocument();
  });

  it('should support filtering by type', () => {
    render(<WatchedItemsList {...defaultProps} filterType="issue" />);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.queryByText('Add user dashboard')).not.toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<WatchedItemsList {...defaultProps} loading />);
    expect(screen.getByTestId('watched-items-loading')).toBeInTheDocument();
  });
});

describe('WatcherSettings', () => {
  const mockSettings: AutoWatchSettings = {
    autoWatchCreated: true,
    autoWatchAssigned: true,
    autoWatchCommented: false,
    defaultNotificationLevel: 'all',
  };

  const defaultProps: WatcherSettingsProps = {
    settings: mockSettings,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render auto-watch options', () => {
    render(<WatcherSettings {...defaultProps} />);
    expect(screen.getByText(/items you create/i)).toBeInTheDocument();
    expect(screen.getByText(/items assigned to you/i)).toBeInTheDocument();
    expect(screen.getByText(/items you comment on/i)).toBeInTheDocument();
  });

  it('should show current toggle states', () => {
    render(<WatcherSettings {...defaultProps} />);
    const switches = screen.getAllByRole('switch');
    expect(switches[0]).toHaveAttribute('data-state', 'checked'); // autoWatchCreated
    expect(switches[1]).toHaveAttribute('data-state', 'checked'); // autoWatchAssigned
    expect(switches[2]).toHaveAttribute('data-state', 'unchecked'); // autoWatchCommented
  });

  it('should call onChange when toggle changed', () => {
    const onChange = vi.fn();
    render(<WatcherSettings {...defaultProps} onChange={onChange} />);

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[2]); // Toggle autoWatchCommented

    expect(onChange).toHaveBeenCalledWith({
      ...mockSettings,
      autoWatchCommented: true,
    });
  });

  it('should show default notification level selector', () => {
    render(<WatcherSettings {...defaultProps} />);
    expect(screen.getByText(/default notification level/i)).toBeInTheDocument();
  });

  it('should show all notification level options', () => {
    render(<WatcherSettings {...defaultProps} />);
    // The selected option should be visible
    expect(screen.getByText(/all activity/i)).toBeInTheDocument();
  });

  it('should call onChange when notification level changed', () => {
    const onChange = vi.fn();
    render(<WatcherSettings {...defaultProps} onChange={onChange} />);

    // Find and click the notification level dropdown
    const dropdown = screen.getByRole('combobox');
    fireEvent.click(dropdown);

    // Select a different option
    const mentionsOption = screen.getByRole('option', { name: /mentions only/i });
    fireEvent.click(mentionsOption);

    expect(onChange).toHaveBeenCalledWith({
      ...mockSettings,
      defaultNotificationLevel: 'mentions',
    });
  });
});
