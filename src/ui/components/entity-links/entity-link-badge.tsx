/**
 * Badge component for a single entity link (Issue #1276).
 *
 * Displays the linked entity type and link relationship with an icon,
 * and supports click-to-navigate and optional remove action.
 */
import { Brain, CheckSquare, Folder, Mail, MessageSquare, User, X } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import type { EntityLink } from '@/ui/lib/api-types';

const TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  message: Mail,
  thread: MessageSquare,
  memory: Brain,
  todo: CheckSquare,
  project: Folder,
  project_event: Folder,
  contact: User,
};

const TYPE_LABELS: Record<string, string> = {
  message: 'Message',
  thread: 'Thread',
  memory: 'Memory',
  todo: 'Todo',
  project: 'Project',
  project_event: 'Event',
  contact: 'Contact',
};

const LINK_TYPE_LABELS: Record<string, string> = {
  related: 'Related',
  caused_by: 'Caused by',
  resulted_in: 'Resulted in',
  about: 'About',
};

interface EntityLinkBadgeProps {
  link: EntityLink;
  /** Which side of the link to display (source or target). */
  side: 'source' | 'target';
  onClick?: () => void;
  onRemove?: () => void;
}

export function EntityLinkBadge({ link, side, onClick, onRemove }: EntityLinkBadgeProps) {
  const entity_type = side === 'source' ? link.source_type : link.target_type;
  const Icon = TYPE_ICONS[entity_type] ?? MessageSquare;
  const label = TYPE_LABELS[entity_type] ?? entity_type;
  const linkLabel = LINK_TYPE_LABELS[link.link_type] ?? link.link_type;

  return (
    <Badge
      variant="outline"
      className="gap-1 pr-1 cursor-pointer hover:bg-accent transition-colors"
      onClick={onClick}
      data-testid="entity-link-badge"
    >
      <Icon className="size-3" />
      <span className="text-xs">
        {linkLabel}: {label}
      </span>
      {onRemove && (
        <button
          type="button"
          className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          data-testid="entity-link-remove"
        >
          <X className="size-3" />
        </button>
      )}
    </Badge>
  );
}
