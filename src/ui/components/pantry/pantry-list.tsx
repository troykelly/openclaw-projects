import { usePantryItems, useDepletePantryItems, useDeletePantryItem } from '@/ui/hooks/queries/use-pantry.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

interface PantryListProps {
  filters?: Record<string, string>;
}

export function PantryList({ filters }: PantryListProps) {
  const { data, isLoading } = usePantryItems(filters);
  const depleteItems = useDepletePantryItems();
  const deleteItem = useDeletePantryItem();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading pantry…</div>;

  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No items in the pantry.</p>
      )}

      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{item.name}</span>
                {item.quantity && (
                  <span className="text-xs text-muted-foreground">{item.quantity}</span>
                )}
                <Badge variant="outline">{item.location}</Badge>
                {item.category && <Badge variant="secondary">{item.category}</Badge>}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {item.is_leftover && <span>Leftover: {item.leftover_dish}</span>}
                {item.use_by_date && <span>Use by: {item.use_by_date}</span>}
                {item.use_soon && <Badge variant="destructive">Use soon</Badge>}
              </div>
            </div>

            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => depleteItems.mutate([item.id])}
                disabled={depleteItems.isPending}
              >
                Used
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteItem.mutate(item.id)}
                disabled={deleteItem.isPending}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
