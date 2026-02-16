import { useMealLog, useDeleteMealLog } from '@/ui/hooks/queries/use-meal-log.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';
import type { MealLogEntry } from '@/ui/lib/api-types.ts';

interface MealLogListProps {
  onSelect: (meal: MealLogEntry) => void;
  filters?: Record<string, string>;
}

export function MealLogList({ onSelect, filters }: MealLogListProps) {
  const { data, isLoading } = useMealLog(filters);
  const deleteMeal = useDeleteMealLog();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading meals…</div>;

  const meals = data?.meals ?? [];

  return (
    <div className="space-y-3">
      {meals.length === 0 && (
        <p className="text-sm text-muted-foreground">No meals logged yet.</p>
      )}

      <ul className="divide-y">
        {meals.map((meal) => (
          <li key={meal.id} className="flex items-center justify-between py-3">
            <button
              type="button"
              className="flex flex-col gap-1 text-left hover:underline"
              onClick={() => onSelect(meal)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{meal.title}</span>
                <Badge variant="outline">{meal.meal_type}</Badge>
                <Badge variant="secondary">{meal.source.replace('_', ' ')}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {meal.meal_date}
                {meal.cuisine && ` · ${meal.cuisine}`}
                {meal.restaurant && ` · ${meal.restaurant}`}
                {meal.rating && ` · ${'★'.repeat(meal.rating)}`}
              </div>
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMeal.mutate(meal.id)}
              disabled={deleteMeal.isPending}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
