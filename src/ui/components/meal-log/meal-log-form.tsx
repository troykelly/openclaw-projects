import { useState } from 'react';
import { useCreateMealLog } from '@/ui/hooks/queries/use-meal-log.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Input } from '@/ui/components/ui/input.tsx';
import { Label } from '@/ui/components/ui/label.tsx';

interface MealLogFormProps {
  onCreated?: () => void;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const SOURCES = ['home_cooked', 'ordered', 'leftovers', 'ate_out', 'other'] as const;

export function MealLogForm({ onCreated }: MealLogFormProps) {
  const createMeal = useCreateMealLog();
  const [title, setTitle] = useState('');
  const [mealType, setMealType] = useState<string>('dinner');
  const [source, setSource] = useState<string>('home_cooked');
  const [cuisine, setCuisine] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    createMeal.mutate(
      {
        title: title.trim(),
        meal_date: new Date().toISOString().split('T')[0],
        meal_type: mealType,
        source,
        cuisine: cuisine || undefined,
      },
      { onSuccess: () => { setTitle(''); onCreated?.(); } },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="meal-title">What did you eat?</Label>
        <Input
          id="meal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Pad Thai"
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="meal-type">Meal</Label>
          <select
            id="meal-type"
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="meal-source">Source</Label>
          <select
            id="meal-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="meal-cuisine">Cuisine</Label>
          <Input
            id="meal-cuisine"
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            placeholder="e.g. Thai"
          />
        </div>
      </div>

      <Button type="submit" disabled={createMeal.isPending}>
        Log Meal
      </Button>
    </form>
  );
}
