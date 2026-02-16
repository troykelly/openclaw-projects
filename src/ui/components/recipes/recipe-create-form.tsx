import { useState } from 'react';
import { useCreateRecipe } from '@/ui/hooks/queries/use-recipes.ts';
import { Button } from '@/ui/components/ui/button.tsx';
import { Input } from '@/ui/components/ui/input.tsx';
import { Label } from '@/ui/components/ui/label.tsx';
import { Textarea } from '@/ui/components/ui/textarea.tsx';

interface RecipeCreateFormProps {
  onCreated: (id: string) => void;
}

export function RecipeCreateForm({ onCreated }: RecipeCreateFormProps) {
  const createRecipe = useCreateRecipe();
  const [title, setTitle] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [servings, setServings] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    createRecipe.mutate(
      {
        title: title.trim(),
        cuisine: cuisine || undefined,
        servings: servings ? Number.parseInt(servings, 10) : undefined,
        description: description || undefined,
      },
      {
        onSuccess: (data) => onCreated(data.id),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="recipe-title">Title</Label>
        <Input
          id="recipe-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Spaghetti Bolognese"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="recipe-cuisine">Cuisine</Label>
          <Input
            id="recipe-cuisine"
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            placeholder="e.g. Italian"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="recipe-servings">Servings</Label>
          <Input
            id="recipe-servings"
            type="number"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            placeholder="4"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="recipe-desc">Description</Label>
        <Textarea
          id="recipe-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description…"
          rows={2}
        />
      </div>

      <Button type="submit" disabled={createRecipe.isPending}>
        Create Recipe
      </Button>
    </form>
  );
}
