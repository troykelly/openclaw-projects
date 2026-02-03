/**
 * Mention parsing and utility functions
 * Issue #400: Implement @mention support with notifications
 */

export interface MentionUser {
  id: string;
  name: string;
  avatar?: string;
}

export interface Mention {
  id: string;
  name: string;
  type: 'user' | 'team';
}

// Regex to match mention tokens: @[Name](type:id)
const MENTION_REGEX = /@\[([^\]]+)\]\((\w+):([^)]+)\)/g;

/**
 * Parse mention tokens from text and return Mention objects
 */
export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  let match;

  // Reset regex
  const regex = new RegExp(MENTION_REGEX.source, 'g');

  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      name: match[1],
      type: match[2] as 'user' | 'team',
      id: match[3],
    });
  }

  return mentions;
}

/**
 * Extract unique mention IDs from text
 */
export function extractMentionIds(text: string): string[] {
  const mentions = parseMentions(text);
  const uniqueIds = new Set(mentions.map((m) => m.id));
  return Array.from(uniqueIds);
}

/**
 * Serialize a mention into the token format
 */
export function serializeMentions(
  before: string,
  mention: Mention,
  after: string
): string {
  return `${before}@[${mention.name}](${mention.type}:${mention.id})${after}`;
}

/**
 * Create a mention token string from a user
 */
export function createMentionToken(user: MentionUser, type: 'user' | 'team' = 'user'): string {
  return `@[${user.name}](${type}:${user.id})`;
}

/**
 * Get initials from a name
 */
export function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Find the @ trigger position in text
 * Returns the index of @ and the query after it, or null if no trigger
 */
export function findMentionTrigger(
  text: string,
  cursorPosition: number
): { start: number; query: string } | null {
  // Look backwards from cursor for @
  let searchPos = cursorPosition - 1;

  while (searchPos >= 0) {
    const char = text[searchPos];

    // Found @
    if (char === '@') {
      // Check if it's the start of text or preceded by whitespace
      if (searchPos === 0 || /\s/.test(text[searchPos - 1])) {
        const query = text.slice(searchPos + 1, cursorPosition);
        // Make sure query doesn't contain spaces (would indicate completed mention)
        if (!/\s/.test(query)) {
          return { start: searchPos, query };
        }
      }
      break;
    }

    // Stop if we hit whitespace
    if (/\s/.test(char)) {
      break;
    }

    searchPos--;
  }

  return null;
}

/**
 * Filter users by search query
 */
export function filterUsers(users: MentionUser[], query: string): MentionUser[] {
  if (!query) return users;
  const lowerQuery = query.toLowerCase();
  return users.filter((user) =>
    user.name.toLowerCase().includes(lowerQuery)
  );
}
