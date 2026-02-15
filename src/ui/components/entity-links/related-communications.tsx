/**
 * Related communications section for work item detail (Issue #1276).
 *
 * Shows outbound messages linked to a work item (project or todo)
 * via the entity_link table.
 */
import { Mail, MessageSquare } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import type { EntityLink } from '@/ui/lib/api-types';
import { useEntityLinksToTarget } from '@/ui/hooks/queries/use-entity-links';

const SOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  message: Mail,
  thread: MessageSquare,
};

interface RelatedCommunicationsProps {
  /** 'project' or 'todo' */
  targetType: 'project' | 'todo';
  targetId: string;
}

export function RelatedCommunications({ targetType, targetId }: RelatedCommunicationsProps) {
  const { data, isLoading } = useEntityLinksToTarget(targetType, targetId);
  const links = data?.links ?? [];

  // Only show message/thread source types
  const commLinks = links.filter((l) => l.source_type === 'message' || l.source_type === 'thread');

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading communications...</p>;
  }

  if (commLinks.length === 0) {
    return null;
  }

  return (
    <div data-testid="related-communications">
      <h4 className="text-xs font-medium text-muted-foreground mb-2">Related Communications</h4>
      <div className="space-y-1.5">
        {commLinks.map((link) => (
          <RelatedCommItem key={link.id} link={link} />
        ))}
      </div>
    </div>
  );
}

function RelatedCommItem({ link }: { link: EntityLink }) {
  const Icon = SOURCE_ICONS[link.source_type] ?? MessageSquare;
  const date = new Date(link.created_at);

  return (
    <Card className="shadow-none" data-testid="related-comm-item">
      <CardContent className="p-2 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-xs">
              {link.source_type}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {link.link_type}
            </Badge>
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{date.toLocaleDateString()}</span>
      </CardContent>
    </Card>
  );
}
