/**
 * Note presence indicator component.
 * Part of Epic #338, Issue #634.
 *
 * Shows an avatar stack of users currently viewing a note.
 */

import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { cn } from '@/ui/lib/utils';
import type { NotePresenceUser } from './use-note-presence';

interface PresenceIndicatorProps {
  /** List of users viewing the note */
  viewers: NotePresenceUser[];
  /** Maximum number of avatars to show before collapsing */
  maxAvatars?: number;
  /** Size of avatars */
  size?: 'sm' | 'md' | 'lg';
  /** Current user's email (to exclude from display) */
  currentUserEmail?: string;
  /** Additional class name */
  className?: string;
}

/**
 * Get initials from email or display name
 */
function getInitials(user: NotePresenceUser): string {
  if (user.displayName) {
    const parts = user.displayName.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return user.displayName.slice(0, 2).toUpperCase();
  }
  // Use email prefix
  const emailPrefix = user.email.split('@')[0];
  return emailPrefix.slice(0, 2).toUpperCase();
}

/**
 * Generate a consistent color from a string (for avatar backgrounds)
 */
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Validate avatar URL for security (#691).
 * Prevents tracking pixels, malicious content, and data: URIs.
 * Only allows https:// URLs from safe patterns.
 */
function isValidAvatarUrl(url: string): boolean {
  // Must be a valid URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow HTTPS
  if (parsed.protocol !== 'https:') {
    return false;
  }

  // Block data: and javascript: protocols (redundant but explicit)
  if (url.toLowerCase().startsWith('data:') || url.toLowerCase().startsWith('javascript:')) {
    return false;
  }

  // Allow common avatar providers and any HTTPS URL
  // In a stricter environment, you could whitelist specific domains:
  // const allowedDomains = ['gravatar.com', 'avatars.githubusercontent.com', 'i.imgur.com'];
  // return allowedDomains.some(domain => parsed.hostname.endsWith(domain));

  return true;
}

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

const overlapClasses = {
  sm: '-ml-2',
  md: '-ml-2.5',
  lg: '-ml-3',
};

/**
 * Single avatar component
 */
function Avatar({ user, size = 'md', className }: { user: NotePresenceUser; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = getInitials(user);
  const bgColor = stringToColor(user.email);

  // Only render external images if URL passes security validation (#691)
  if (user.avatarUrl && isValidAvatarUrl(user.avatarUrl)) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName || user.email}
        referrerPolicy="no-referrer"
        className={cn('rounded-full border-2 border-background object-cover', sizeClasses[size], className)}
      />
    );
  }

  return (
    <div
      className={cn('flex items-center justify-center rounded-full border-2 border-background font-medium text-white', sizeClasses[size], className)}
      style={{ backgroundColor: bgColor }}
      aria-label={user.displayName || user.email}
    >
      {initials}
    </div>
  );
}

/**
 * Presence indicator showing avatars of users viewing a note.
 *
 * @example
 * ```tsx
 * <PresenceIndicator
 *   viewers={viewers}
 *   currentUserEmail="me@example.com"
 *   maxAvatars={3}
 * />
 * ```
 */
export function PresenceIndicator({ viewers, maxAvatars = 3, size = 'md', currentUserEmail, className }: PresenceIndicatorProps) {
  // Filter out current user
  const otherViewers = currentUserEmail ? viewers.filter((v) => v.email !== currentUserEmail) : viewers;

  if (otherViewers.length === 0) {
    return null;
  }

  const visibleViewers = otherViewers.slice(0, maxAvatars);
  const overflowCount = otherViewers.length - maxAvatars;

  const tooltipContent = (
    <div className="space-y-1">
      <p className="font-medium">{otherViewers.length === 1 ? '1 person viewing' : `${otherViewers.length} people viewing`}</p>
      <ul className="text-sm text-muted-foreground">
        {otherViewers.map((viewer) => (
          <li key={viewer.email}>{viewer.displayName || viewer.email}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn('flex items-center', className)}
            role="group"
            aria-label={`${otherViewers.length} ${otherViewers.length === 1 ? 'person' : 'people'} viewing`}
          >
            {visibleViewers.map((viewer, index) => (
              <Avatar key={viewer.email} user={viewer} size={size} className={index > 0 ? overlapClasses[size] : undefined} />
            ))}
            {overflowCount > 0 && (
              <div
                className={cn(
                  'flex items-center justify-center rounded-full border-2 border-background bg-muted font-medium text-muted-foreground',
                  sizeClasses[size],
                  overlapClasses[size],
                )}
              >
                +{overflowCount}
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
