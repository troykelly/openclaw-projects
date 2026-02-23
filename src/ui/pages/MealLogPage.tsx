/**
 * Meal Log page.
 *
 * Displays a list of logged meals alongside stats, with the ability
 * to log new meals. Composes MealLogList, MealLogStats, and MealLogForm.
 *
 * @see Issue #1611
 */
import React, { useState, useCallback } from 'react';
import { UtensilsCrossed, Plus } from 'lucide-react';
import { MealLogList, MealLogStats, MealLogForm } from '@/ui/components/meal-log';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import type { MealLogEntry } from '@/ui/lib/api-types';

export function MealLogPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [_selectedMeal, setSelectedMeal] = useState<MealLogEntry | null>(null);

  const handleSelect = useCallback((meal: MealLogEntry) => {
    setSelectedMeal(meal);
  }, []);

  const handleCreated = useCallback(() => {
    setCreateOpen(false);
  }, []);

  return (
    <div data-testid="page-meal-log" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UtensilsCrossed className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Meal Log</h1>
            <p className="text-sm text-muted-foreground">Track what you eat</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="log-meal-button">
          <Plus className="mr-2 size-4" />
          Log Meal
        </Button>
      </div>

      {/* Stats + List */}
      <div className="flex-1 grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Main list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Meals</CardTitle>
          </CardHeader>
          <CardContent>
            <MealLogList onSelect={handleSelect} />
          </CardContent>
        </Card>

        {/* Stats sidebar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <MealLogStats days={30} />
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="meal-log-create-dialog">
          <DialogHeader>
            <DialogTitle>Log a Meal</DialogTitle>
            <DialogDescription>Record what you ate.</DialogDescription>
          </DialogHeader>
          <MealLogForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
