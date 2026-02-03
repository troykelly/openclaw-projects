/**
 * Mentions components
 * Issue #400: Implement @mention support with notifications
 */
export { MentionAutocomplete } from './mention-autocomplete';
export type { MentionAutocompleteProps } from './mention-autocomplete';
export { MentionBadge } from './mention-badge';
export type { MentionBadgeProps } from './mention-badge';
export { MentionInput } from './mention-input';
export type { MentionInputProps } from './mention-input';
export { MentionList } from './mention-list';
export type { MentionListProps } from './mention-list';
export {
  parseMentions,
  extractMentionIds,
  serializeMentions,
  createMentionToken,
  getInitials,
  findMentionTrigger,
  filterUsers,
} from './mention-utils';
export type { Mention, MentionUser } from './mention-utils';
