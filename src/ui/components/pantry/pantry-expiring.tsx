import { usePantryExpiring } from '@/ui/hooks/queries/use-pantry.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';

interface PantryExpiringProps {
  days?: number;
}

export function PantryExpiring({ days = 3 }: PantryExpiringProps) {
  const { data, isLoading } = usePantryExpiring(days);

  if (isLoading) return <div className="p-4 text-muted-foreground">Checking…</div>;

  const items = data?.items ?? [];

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing expiring in the next {days} days.</p>;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Expiring soon ({items.length})</h4>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            <span>{item.name}</span>
            <Badge variant="outline">{item.location}</Badge>
            {item.use_by_date && (
              <span className="text-xs text-muted-foreground">by {item.use_by_date}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
