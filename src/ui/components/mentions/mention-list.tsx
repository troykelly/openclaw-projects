/**
 * List display for mentions
 * Issue #400: Implement @mention support with notifications
 */
import * as React from 'react';
import { Users, Building } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { MentionBadge } from './mention-badge';
import type { Mention } from './mention-utils';

export interface MentionListProps {
  mentions: Mention[];
  onMentionClick?: (mention: Mention) => void;
  groupByType?: boolean;
  className?: string;
}

export function MentionList({ mentions, onMentionClick, groupByType = false, className }: MentionListProps) {
  if (mentions.length === 0) {
    return <div className={cn('text-sm text-muted-foreground', className)}>No mentions</div>;
  }

  if (!groupByType) {
    return (
      <div className={cn('flex flex-wrap gap-1', className)}>
        {mentions.map((mention) => (
          <MentionBadge key={`${mention.type}-${mention.id}`} mention={mention} onClick={onMentionClick} />
        ))}
      </div>
    );
  }

  // Group by type
  const userMentions = mentions.filter((m) => m.type === 'user');
  const teamMentions = mentions.filter((m) => m.type === 'team');

  return (
    <div className={cn('space-y-3', className)}>
      {userMentions.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>Users</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {userMentions.map((mention) => (
              <MentionBadge key={mention.id} mention={mention} onClick={onMentionClick} />
            ))}
          </div>
        </div>
      )}

      {teamMentions.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
            <Building className="h-3.5 w-3.5" />
            <span>Teams</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {teamMentions.map((mention) => (
              <MentionBadge key={mention.id} mention={mention} onClick={onMentionClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
