import { useState } from 'react';
import {
  useListDetail,
  useAddListItems,
  useCheckItems,
  useUncheckItems,
  useResetList,
} from '@/ui/hooks/queries/use-lists.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Input } from '@/ui/components/ui/input.tsx';
import { ListItemRow } from './list-item-row.tsx';

interface ListDetailProps {
  listId: string;
  onBack: () => void;
}

export function ListDetail({ listId, onBack }: ListDetailProps) {
  const { data, isLoading } = useListDetail(listId);
  const addItems = useAddListItems(listId);
  const checkItems = useCheckItems(listId);
  const uncheckItems = useUncheckItems(listId);
  const resetList = useResetList(listId);

  const [newItemName, setNewItemName] = useState('');

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-muted-foreground">List not found.</div>;

  function handleAddItem() {
    const name = newItemName.trim();
    if (!name) return;
    addItems.mutate({ items: [{ name }] });
    setNewItemName('');
  }

  function handleToggle(itemId: string, isChecked: boolean) {
    if (isChecked) {
      uncheckItems.mutate({ item_ids: [itemId] });
    } else {
      checkItems.mutate({ item_ids: [itemId] });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-lg font-semibold">{data.name}</h2>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Add an item…"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
        />
        <Button size="sm" onClick={handleAddItem} disabled={addItems.isPending}>
          Add
        </Button>
      </div>

      <ul className="divide-y">
        {(data.items ?? []).map((item) => (
          <ListItemRow key={item.id} item={item} onToggle={handleToggle} />
        ))}
      </ul>

      {(data.items ?? []).length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetList.mutate()}
          disabled={resetList.isPending}
        >
          Reset List
        </Button>
      )}
    </div>
  );
}
