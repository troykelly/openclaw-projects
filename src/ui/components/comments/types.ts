/**
 * Types for comments system
 * Issue #399: Implement comments system with threading
 */

/** Author of a comment */
export interface Author {
  id: string;
  name: string;
  avatar?: string;
}

/** Reaction on a comment */
export interface CommentReaction {
  emoji: string;
  count: number;
  users: string[];
}

/** A comment on a work item */
export interface Comment {
  id: string;
  content: string;
  authorId: string;
  author: Author;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  reactions: CommentReaction[];
}

/** Common reaction emojis */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😕', '🚀', '👀'] as const;

export type ReactionEmoji = typeof REACTION_EMOJIS[number];
