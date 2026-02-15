import { useMealLogStats } from '@/ui/hooks/queries/use-meal-log.ts';

interface MealLogStatsProps {
  days?: number;
}

export function MealLogStats({ days = 30 }: MealLogStatsProps) {
  const { data, isLoading } = useMealLogStats(days);

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading stats…</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {data.total} meals in the last {data.days} days
      </div>

      {data.by_source.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">By Source</h4>
          <ul className="space-y-1 text-sm">
            {data.by_source.map((s) => (
              <li key={s.source} className="flex justify-between">
                <span>{s.source.replace('_', ' ')}</span>
                <span className="text-muted-foreground">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.by_cuisine.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">By Cuisine</h4>
          <ul className="space-y-1 text-sm">
            {data.by_cuisine.map((c) => (
              <li key={c.cuisine} className="flex justify-between">
                <span>{c.cuisine}</span>
                <span className="text-muted-foreground">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
