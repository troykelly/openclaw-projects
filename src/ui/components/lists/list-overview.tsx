import { useLists, useCreateList, useDeleteList } from '@/ui/hooks/queries/use-lists.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';
import type { SharedList } from '@/ui/lib/api-types.ts';

interface ListOverviewProps {
  onSelect: (list: SharedList) => void;
}

export function ListOverview({ onSelect }: ListOverviewProps) {
  const { data, isLoading } = useLists();
  const createList = useCreateList();
  const deleteList = useDeleteList();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading lists…</div>;

  const lists = data?.lists ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Shared Lists</h2>
        <Button
          size="sm"
          onClick={() => createList.mutate({ name: 'New List' })}
          disabled={createList.isPending}
        >
          New List
        </Button>
      </div>

      {lists.length === 0 && (
        <p className="text-sm text-muted-foreground">No lists yet. Create one to get started.</p>
      )}

      <ul className="divide-y">
        {lists.map((list) => (
          <li key={list.id} className="flex items-center justify-between py-2">
            <button
              type="button"
              className="flex items-center gap-2 text-left hover:underline"
              onClick={() => onSelect(list)}
            >
              <span className="font-medium">{list.name}</span>
              <Badge variant="outline">{list.list_type}</Badge>
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteList.mutate(list.id)}
              disabled={deleteList.isPending}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
