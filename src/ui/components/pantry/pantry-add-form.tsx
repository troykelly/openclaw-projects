import { useState } from 'react';
import { useCreatePantryItem } from '@/ui/hooks/queries/use-pantry.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Input } from '@/ui/components/ui/input.tsx';
import { Label } from '@/ui/components/ui/label.tsx';

const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter'] as const;

interface PantryAddFormProps {
  onAdded?: () => void;
}

export function PantryAddForm({ onAdded }: PantryAddFormProps) {
  const createItem = useCreatePantryItem();
  const [name, setName] = useState('');
  const [location, setLocation] = useState<string>('fridge');
  const [quantity, setQuantity] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    createItem.mutate(
      {
        name: name.trim(),
        location,
        quantity: quantity || undefined,
      },
      { onSuccess: () => { setName(''); setQuantity(''); onAdded?.(); } },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label htmlFor="pantry-name">Item</Label>
        <Input
          id="pantry-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chicken thighs"
          required
        />
      </div>

      <div className="w-24 space-y-1">
        <Label htmlFor="pantry-qty">Qty</Label>
        <Input
          id="pantry-qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="500g"
        />
      </div>

      <div className="w-28 space-y-1">
        <Label htmlFor="pantry-loc">Location</Label>
        <select
          id="pantry-loc"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-sm"
        >
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={createItem.isPending}>
        Add
      </Button>
    </form>
  );
}
