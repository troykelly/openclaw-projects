/**
 * Types for comments system
 * Issue #399: Implement comments system with threading
 * Issue #1839: Fixed to match actual API response shapes
 */

/** A comment on a work item — matches actual API response. */
export interface Comment {
  id: string;
  work_item_id: string;
  parent_id: string | null;
  user_email: string;
  content: string;
  mentions: string[] | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  /** Reactions keyed by emoji with count values: { "👍": 2, "❤️": 1 } */
  reactions: Record<string, number>;
}

/** Common reaction emojis */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😕', '🚀', '👀'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
