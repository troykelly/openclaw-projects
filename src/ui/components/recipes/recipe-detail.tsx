import { useRecipeDetail } from '@/ui/hooks/queries/use-recipes.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

interface RecipeDetailProps {
  recipeId: string;
  onBack: () => void;
}

export function RecipeDetail({ recipeId, onBack }: RecipeDetailProps) {
  const { data, isLoading } = useRecipeDetail(recipeId);

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-muted-foreground">Recipe not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">{data.title}</h2>
        {data.is_favourite && <span className="text-lg">★</span>}
      </div>

      {data.description && <p className="text-muted-foreground">{data.description}</p>}

      <div className="flex flex-wrap gap-2 text-sm">
        {data.cuisine && <Badge variant="outline">{data.cuisine}</Badge>}
        {data.difficulty && <Badge variant="secondary">{data.difficulty}</Badge>}
        {data.meal_type.map((t) => (
          <Badge key={t} variant="outline">{t}</Badge>
        ))}
        {data.tags.map((t) => (
          <Badge key={t} variant="secondary">{t}</Badge>
        ))}
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        {data.prep_time_min != null && <span>Prep: {data.prep_time_min} min</span>}
        {data.cook_time_min != null && <span>Cook: {data.cook_time_min} min</span>}
        {data.total_time_min != null && <span>Total: {data.total_time_min} min</span>}
        {data.servings != null && <span>Serves: {data.servings}</span>}
      </div>

      {data.ingredients.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Ingredients</h3>
          <ul className="space-y-1">
            {data.ingredients.map((ing) => (
              <li key={ing.id} className="flex items-center gap-2 text-sm">
                <span>
                  {[ing.quantity, ing.unit].filter(Boolean).join(' ')} {ing.name}
                </span>
                {ing.is_optional && (
                  <span className="text-xs text-muted-foreground">(optional)</span>
                )}
                {ing.category && <Badge variant="outline">{ing.category}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.steps.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Steps</h3>
          <ol className="space-y-2">
            {data.steps.map((step) => (
              <li key={step.id} className="flex gap-3 text-sm">
                <span className="font-medium text-muted-foreground">{step.step_number}.</span>
                <span>{step.instruction}</span>
                {step.duration_min != null && (
                  <span className="text-xs text-muted-foreground">({step.duration_min} min)</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.notes && (
        <div>
          <h3 className="mb-1 font-semibold">Notes</h3>
          <p className="text-sm text-muted-foreground">{data.notes}</p>
        </div>
      )}
    </div>
  );
}
