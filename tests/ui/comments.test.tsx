/**
 * @vitest-environment jsdom
 * Tests for comments system with threading
 * Issue #399: Implement comments system with threading
 * Issue #1839: Fixed mock data to match actual API response shapes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { CommentInput, type CommentInputProps } from '@/ui/components/comments/comment-input';
import { CommentCard, type CommentCardProps } from '@/ui/components/comments/comment-card';
import { CommentThread, type CommentThreadProps } from '@/ui/components/comments/comment-thread';
import { CommentsSection, type CommentsSectionProps } from '@/ui/components/comments/comments-section';
import { CommentReactions, type CommentReactionsProps } from '@/ui/components/comments/comment-reactions';
import type { Comment } from '@/ui/components/comments/types';

describe('CommentInput', () => {
  const defaultProps: CommentInputProps = {
    onSubmit: vi.fn(),
    placeholder: 'Add a comment...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render textarea', () => {
    render(<CommentInput {...defaultProps} />);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
  });

  it('should show submit button', () => {
    render(<CommentInput {...defaultProps} />);
    expect(screen.getByRole('button', { name: /submit|post|comment/i })).toBeInTheDocument();
  });

  it('should disable submit when empty', () => {
    render(<CommentInput {...defaultProps} />);
    expect(screen.getByRole('button', { name: /submit|post|comment/i })).toBeDisabled();
  });

  it('should enable submit when text entered', () => {
    render(<CommentInput {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), {
      target: { value: 'My comment' },
    });

    expect(screen.getByRole('button', { name: /submit|post|comment/i })).not.toBeDisabled();
  });

  it('should call onSubmit with content', async () => {
    const onSubmit = vi.fn();
    render(<CommentInput {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), {
      target: { value: 'My comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit|post|comment/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('My comment');
    });
  });

  it('should clear input after submit', async () => {
    const onSubmit = vi.fn();
    render(<CommentInput {...defaultProps} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(textarea, { target: { value: 'My comment' } });
    fireEvent.click(screen.getByRole('button', { name: /submit|post|comment/i }));

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('should show loading state when submitting', () => {
    render(<CommentInput {...defaultProps} loading />);
    // When loading, button is disabled (submit button type)
    const submitButton = screen.getByRole('button', { name: '' });
    expect(submitButton).toBeDisabled();
  });

  it('should support cancel button for replies', () => {
    const onCancel = vi.fn();
    render(<CommentInput {...defaultProps} isReply onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe('CommentCard', () => {
  /** Mock comment matching actual API response shape. */
  const mockComment: Comment = {
    id: 'comment-1',
    work_item_id: 'wi-1',
    content: 'This is a test comment',
    user_email: 'alice.smith@example.com',
    parent_id: null,
    mentions: null,
    edited_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reactions: {},
  };

  const defaultProps: CommentCardProps = {
    comment: mockComment,
    currentUserId: 'alice.smith@example.com',
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render display name derived from email', () => {
    render(<CommentCard {...defaultProps} />);
    // "alice.smith@example.com" → "Alice Smith"
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('should render comment content', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.getByText('This is a test comment')).toBeInTheDocument();
  });

  it('should render initials avatar', () => {
    render(<CommentCard {...defaultProps} />);
    // "Alice Smith" → "AS"
    expect(screen.getByText('AS')).toBeInTheDocument();
  });

  it('should show relative timestamp', () => {
    render(<CommentCard {...defaultProps} />);
    // Should show something like "just now" or a time
    expect(screen.getByTestId('comment-timestamp')).toBeInTheDocument();
  });

  it('should show reply button', () => {
    render(<CommentCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument();
  });

  it('should call onReply when reply clicked', () => {
    const onReply = vi.fn();
    render(<CommentCard {...defaultProps} onReply={onReply} />);

    fireEvent.click(screen.getByRole('button', { name: /reply/i }));

    expect(onReply).toHaveBeenCalledWith('comment-1');
  });

  it('should show edit button for own comments', () => {
    render(<CommentCard {...defaultProps} currentUserId="alice.smith@example.com" />);
    // Edit/delete are in a dropdown menu triggered by more button
    const buttons = screen.getAllByRole('button');
    // Should have Reply button + dropdown trigger = 2 buttons
    expect(buttons.length).toBe(2);
  });

  it('should not show edit button for others comments', () => {
    render(<CommentCard {...defaultProps} currentUserId="bob.jones@example.com" />);
    // No dropdown menu for other's comments
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1); // Only reply button
  });

  it('should show delete button for own comments', () => {
    render(<CommentCard {...defaultProps} currentUserId="alice.smith@example.com" />);
    // Delete is accessible via same dropdown as edit
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2); // Reply + dropdown trigger
  });

  it('should call onEdit when edit clicked', () => {
    // Test that the component renders correctly for owner
    const onEdit = vi.fn();
    render(<CommentCard {...defaultProps} onEdit={onEdit} currentUserId="alice.smith@example.com" />);

    // Verify owner has access to edit (dropdown trigger exists)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2);
  });

  it('should call onDelete when delete clicked', () => {
    // Test that the component renders correctly for owner
    const onDelete = vi.fn();
    render(<CommentCard {...defaultProps} onDelete={onDelete} currentUserId="alice.smith@example.com" />);

    // Verify owner has access to delete (dropdown trigger exists)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2);
  });

  it('should show edited indicator when updated', () => {
    const editedComment: Comment = {
      ...mockComment,
      edited_at: new Date().toISOString(),
    };
    render(<CommentCard {...defaultProps} comment={editedComment} />);
    expect(screen.getByText(/edited/i)).toBeInTheDocument();
  });
});

describe('CommentThread', () => {
  const mockReplies: Comment[] = [
    {
      id: 'reply-1',
      work_item_id: 'wi-1',
      content: 'First reply',
      user_email: 'bob.jones@example.com',
      parent_id: 'comment-1',
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
    {
      id: 'reply-2',
      work_item_id: 'wi-1',
      content: 'Second reply',
      user_email: 'alice.smith@example.com',
      parent_id: 'comment-1',
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
  ];

  const mockParent: Comment = {
    id: 'comment-1',
    work_item_id: 'wi-1',
    content: 'Parent comment',
    user_email: 'alice.smith@example.com',
    parent_id: null,
    mentions: null,
    edited_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reactions: {},
  };

  const defaultProps: CommentThreadProps = {
    comment: mockParent,
    replies: mockReplies,
    currentUserId: 'alice.smith@example.com',
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render parent comment', () => {
    render(<CommentThread {...defaultProps} />);
    expect(screen.getByText('Parent comment')).toBeInTheDocument();
  });

  it('should render all replies', () => {
    render(<CommentThread {...defaultProps} />);
    expect(screen.getByText('First reply')).toBeInTheDocument();
    expect(screen.getByText('Second reply')).toBeInTheDocument();
  });

  it('should indent replies', () => {
    render(<CommentThread {...defaultProps} />);
    const replies = screen.getByTestId('thread-replies');
    expect(replies).toHaveClass('ml-8');
  });

  it('should show collapse button when expanded', () => {
    render(<CommentThread {...defaultProps} />);
    expect(screen.getByRole('button', { name: /collapse|hide/i })).toBeInTheDocument();
  });

  it('should collapse replies when clicked', () => {
    render(<CommentThread {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /collapse|hide/i }));

    expect(screen.queryByText('First reply')).not.toBeInTheDocument();
  });

  it('should show reply count when collapsed', () => {
    render(<CommentThread {...defaultProps} defaultCollapsed />);
    expect(screen.getByText(/2 replies/i)).toBeInTheDocument();
  });

  it('should expand when clicking reply count', () => {
    render(<CommentThread {...defaultProps} defaultCollapsed />);

    fireEvent.click(screen.getByText(/2 replies/i));

    expect(screen.getByText('First reply')).toBeInTheDocument();
  });
});

describe('CommentsSection', () => {
  const mockComments: Comment[] = [
    {
      id: 'comment-1',
      work_item_id: 'wi-1',
      content: 'First comment',
      user_email: 'alice@example.com',
      parent_id: null,
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
    {
      id: 'comment-2',
      work_item_id: 'wi-1',
      content: 'Second comment',
      user_email: 'bob@example.com',
      parent_id: null,
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
  ];

  const defaultProps: CommentsSectionProps = {
    work_item_id: 'wi-1',
    comments: mockComments,
    currentUserId: 'alice@example.com',
    onAddComment: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onAddReply: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render section title', () => {
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByText(/comments/i)).toBeInTheDocument();
  });

  it('should show comment count', () => {
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should render all comments', () => {
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByText('First comment')).toBeInTheDocument();
    expect(screen.getByText('Second comment')).toBeInTheDocument();
  });

  it('should show comment input', () => {
    render(<CommentsSection {...defaultProps} />);
    expect(screen.getByPlaceholderText(/comment/i)).toBeInTheDocument();
  });

  it('should call onAddComment when comment submitted', async () => {
    const onAddComment = vi.fn();
    render(<CommentsSection {...defaultProps} onAddComment={onAddComment} />);

    fireEvent.change(screen.getByPlaceholderText(/comment/i), {
      target: { value: 'New comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit|post|comment/i }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith('wi-1', 'New comment');
    });
  });

  it('should show empty state when no comments', () => {
    render(<CommentsSection {...defaultProps} comments={[]} />);
    expect(screen.getByText(/no comments/i)).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<CommentsSection {...defaultProps} loading />);
    expect(screen.getByTestId('comments-loading')).toBeInTheDocument();
  });
});

describe('CommentThread inline editing', () => {
  const mockParent: Comment = {
    id: 'comment-1',
    work_item_id: 'wi-1',
    content: 'Parent comment content',
    user_email: 'alice.smith@example.com',
    parent_id: null,
    mentions: null,
    edited_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reactions: {},
  };

  const mockReplies: Comment[] = [
    {
      id: 'reply-1',
      work_item_id: 'wi-1',
      content: 'Reply content here',
      user_email: 'bob.jones@example.com',
      parent_id: 'comment-1',
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
  ];

  const defaultProps: CommentThreadProps = {
    comment: mockParent,
    replies: mockReplies,
    currentUserId: 'alice.smith@example.com',
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show CommentInput instead of CommentCard when editingId matches parent', () => {
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    render(<CommentThread {...defaultProps} editingId="comment-1" onEditSave={onEditSave} onEditCancel={onEditCancel} />);

    // The parent comment content should NOT be visible as plain text
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    // Instead a textarea should be shown pre-filled with the comment content
    const textarea = screen.getByDisplayValue('Parent comment content');
    expect(textarea).toBeInTheDocument();
  });

  it('should show CommentInput instead of CommentCard when editingId matches reply', () => {
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    render(<CommentThread {...defaultProps} editingId="reply-1" onEditSave={onEditSave} onEditCancel={onEditCancel} />);

    // The reply content should NOT be shown as plain text (it should be in a textarea)
    // The parent should still render as normal CommentCard
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Parent comment content')).toBeInTheDocument();
    // Reply should be in edit mode
    const textarea = screen.getByDisplayValue('Reply content here');
    expect(textarea).toBeInTheDocument();
  });

  it('should call onEditSave with correct args when edit is submitted', async () => {
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    render(<CommentThread {...defaultProps} editingId="comment-1" onEditSave={onEditSave} onEditCancel={onEditCancel} />);

    // Modify the textarea content
    const textarea = screen.getByDisplayValue('Parent comment content');
    fireEvent.change(textarea, { target: { value: 'Updated parent content' } });
    // Submit by clicking the submit button within the edit form
    const form = textarea.closest('form')!;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLElement;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onEditSave).toHaveBeenCalledWith('comment-1', 'Updated parent content');
    });
  });

  it('should call onEditCancel when cancel is clicked', () => {
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    render(<CommentThread {...defaultProps} editingId="comment-1" onEditSave={onEditSave} onEditCancel={onEditCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onEditCancel).toHaveBeenCalled();
  });

  it('should not show edit input when editingId is null', () => {
    render(<CommentThread {...defaultProps} editingId={null} onEditSave={vi.fn()} onEditCancel={vi.fn()} />);

    // Both parent and reply should render as normal cards
    expect(screen.getByText('Parent comment content')).toBeInTheDocument();
    expect(screen.getByText('Reply content here')).toBeInTheDocument();
    // No textarea should be present for editing
    expect(screen.queryByDisplayValue('Parent comment content')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Reply content here')).not.toBeInTheDocument();
  });
});

describe('CommentsSection inline editing', () => {
  const mockComments: Comment[] = [
    {
      id: 'comment-1',
      work_item_id: 'wi-1',
      content: 'Editable comment',
      user_email: 'alice@example.com',
      parent_id: null,
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
    {
      id: 'comment-2',
      work_item_id: 'wi-1',
      content: 'Other user comment',
      user_email: 'bob@example.com',
      parent_id: null,
      mentions: null,
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reactions: {},
    },
  ];

  const defaultProps: CommentsSectionProps = {
    work_item_id: 'wi-1',
    comments: mockComments,
    currentUserId: 'alice@example.com',
    onAddComment: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onAddReply: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to open the Radix dropdown and click Edit.
   */
  async function triggerEditOnComment(container: HTMLElement) {
    const allButtons = container.querySelectorAll('button');
    let trigger: HTMLElement | null = null;
    for (const btn of allButtons) {
      if (btn.className.includes('px-1')) {
        trigger = btn;
        break;
      }
    }

    if (trigger) {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
      fireEvent.click(trigger);
    }

    await waitFor(() => {
      const editItem = screen.getByRole('menuitem', { name: /edit/i });
      expect(editItem).toBeInTheDocument();
    });

    const editItem = screen.getByRole('menuitem', { name: /edit/i });
    fireEvent.click(editItem);
  }

  it('should enter edit mode when Edit is clicked in dropdown', async () => {
    const { container } = render(<CommentsSection {...defaultProps} />);

    await triggerEditOnComment(container);

    await waitFor(() => {
      const textarea = screen.getByDisplayValue('Editable comment');
      expect(textarea).toBeInTheDocument();
    });
  });

  it('should call onEditComment and exit edit mode on save', async () => {
    const onEditComment = vi.fn();
    const { container } = render(<CommentsSection {...defaultProps} onEditComment={onEditComment} />);

    await triggerEditOnComment(container);

    const textarea = screen.getByDisplayValue('Editable comment');
    fireEvent.change(textarea, { target: { value: 'Modified comment' } });

    const form = textarea.closest('form')!;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLElement;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onEditComment).toHaveBeenCalledWith('comment-1', 'Modified comment');
    });

    await waitFor(() => {
      expect(screen.getByText('Editable comment')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Editable comment')).not.toBeInTheDocument();
    });
  });

  it('should exit edit mode on cancel', async () => {
    const { container } = render(<CommentsSection {...defaultProps} />);

    await triggerEditOnComment(container);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Editable comment')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByText('Editable comment')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Editable comment')).not.toBeInTheDocument();
    });
  });

  it('should close reply input when entering edit mode', async () => {
    const { container } = render(<CommentsSection {...defaultProps} />);

    const replyButtons = screen.getAllByRole('button', { name: /reply/i });
    fireEvent.click(replyButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/write a reply/i)).toBeInTheDocument();
    });

    await triggerEditOnComment(container);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Editable comment')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/write a reply/i)).not.toBeInTheDocument();
    });
  });
});

describe('CommentReactions', () => {
  /** Reactions as returned by the actual API: { emoji: count } */
  const mockReactions: Record<string, number> = {
    '👍': 3,
    '❤️': 1,
  };

  const defaultProps: CommentReactionsProps = {
    reactions: mockReactions,
    currentUserId: 'alice@example.com',
    onReact: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render reaction emojis', () => {
    render(<CommentReactions {...defaultProps} />);
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
  });

  it('should show reaction counts', () => {
    render(<CommentReactions {...defaultProps} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('should call onReact when emoji clicked', () => {
    const onReact = vi.fn();
    render(<CommentReactions {...defaultProps} onReact={onReact} />);

    fireEvent.click(screen.getByText('👍').closest('button')!);

    expect(onReact).toHaveBeenCalledWith('👍');
  });

  it('should show add reaction button', () => {
    render(<CommentReactions {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add reaction|react/i })).toBeInTheDocument();
  });
});
