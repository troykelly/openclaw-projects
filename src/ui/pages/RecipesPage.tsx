/**
 * Recipes page.
 *
 * Displays a list of recipes with create and detail capabilities.
 * Composes the existing RecipeList, RecipeDetail, and RecipeCreateForm
 * components into a full page experience.
 *
 * @see Issue #1611
 */
import React, { useState, useCallback } from 'react';
import { ChefHat, Plus } from 'lucide-react';
import { RecipeList, RecipeDetail, RecipeCreateForm } from '@/ui/components/recipes';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import type { Recipe } from '@/ui/lib/api-types';

type View = { kind: 'list' } | { kind: 'detail'; recipeId: string };

export function RecipesPage(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [createOpen, setCreateOpen] = useState(false);

  const handleSelect = useCallback((recipe: Recipe) => {
    setView({ kind: 'detail', recipeId: recipe.id });
  }, []);

  const handleBack = useCallback(() => {
    setView({ kind: 'list' });
  }, []);

  const handleCreated = useCallback((id: string) => {
    setCreateOpen(false);
    setView({ kind: 'detail', recipeId: id });
  }, []);

  return (
    <div data-testid="page-recipes" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChefHat className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Recipes</h1>
            <p className="text-sm text-muted-foreground">Manage your recipe collection</p>
          </div>
        </div>
        {view.kind === 'list' && (
          <Button onClick={() => setCreateOpen(true)} data-testid="create-recipe-button">
            <Plus className="mr-2 size-4" />
            New Recipe
          </Button>
        )}
      </div>

      {/* Content */}
      <Card className="flex-1">
        <CardContent className="p-6">
          {view.kind === 'list' && <RecipeList onSelect={handleSelect} />}
          {view.kind === 'detail' && (
            <RecipeDetail recipeId={view.recipeId} onBack={handleBack} />
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="recipe-create-dialog">
          <DialogHeader>
            <DialogTitle>New Recipe</DialogTitle>
            <DialogDescription>Add a new recipe to your collection.</DialogDescription>
          </DialogHeader>
          <RecipeCreateForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
