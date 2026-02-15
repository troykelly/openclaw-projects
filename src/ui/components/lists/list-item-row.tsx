import { Badge } from '@/ui/components/ui/badge.tsx';
import type { SharedListItem } from '@/ui/lib/api-types.ts';

interface ListItemRowProps {
  item: SharedListItem;
  onToggle: (itemId: string, isChecked: boolean) => void;
}

export function ListItemRow({ item, onToggle }: ListItemRowProps) {
  return (
    <li className="flex items-center gap-3 py-2">
      <input
        type="checkbox"
        checked={item.is_checked}
        onChange={() => onToggle(item.id, item.is_checked)}
        className="h-4 w-4 rounded border-muted-foreground"
      />
      <span className={item.is_checked ? 'line-through text-muted-foreground' : ''}>
        {item.name}
      </span>
      {item.quantity && (
        <span className="text-xs text-muted-foreground">{item.quantity}</span>
      )}
      {item.category && <Badge variant="outline">{item.category}</Badge>}
      {item.is_recurring && <Badge variant="secondary">recurring</Badge>}
    </li>
  );
}
