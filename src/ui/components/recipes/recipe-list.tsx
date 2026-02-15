import { useRecipes, useDeleteRecipe } from '@/ui/hooks/queries/use-recipes.ts';
import { Badge } from '@/ui/components/ui/badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';
import type { Recipe } from '@/ui/lib/api-types.ts';

interface RecipeListProps {
  onSelect: (recipe: Recipe) => void;
  filters?: Record<string, string>;
}

export function RecipeList({ onSelect, filters }: RecipeListProps) {
  const { data, isLoading } = useRecipes(filters);
  const deleteRecipe = useDeleteRecipe();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading recipes…</div>;

  const recipes = data?.recipes ?? [];

  return (
    <div className="space-y-3">
      {recipes.length === 0 && (
        <p className="text-sm text-muted-foreground">No recipes found.</p>
      )}

      <ul className="divide-y">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="flex items-center justify-between py-3">
            <button
              type="button"
              className="flex flex-col gap-1 text-left hover:underline"
              onClick={() => onSelect(recipe)}
            >
              <span className="font-medium">{recipe.title}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {recipe.cuisine && <Badge variant="outline">{recipe.cuisine}</Badge>}
                {recipe.total_time_min && <span>{recipe.total_time_min} min</span>}
                {recipe.is_favourite && <span>★</span>}
                {recipe.rating && <span>{'★'.repeat(recipe.rating)}</span>}
              </div>
            </button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteRecipe.mutate(recipe.id)}
              disabled={deleteRecipe.isPending}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
