/**
 * Save View Button component
 * Issue #406: Implement saved views with sharing
 */
import * as React from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';

export interface SaveViewButtonProps {
  hasActiveFilters: boolean;
  onSave: () => void;
  disabled?: boolean;
}

export function SaveViewButton({ hasActiveFilters, onSave, disabled = false }: SaveViewButtonProps) {
  if (!hasActiveFilters) {
    return null;
  }

  return (
    <Button variant="outline" size="sm" onClick={onSave} disabled={disabled} aria-label="Save view">
      <Bookmark className="h-4 w-4 mr-2" data-testid="save-view-icon" />
      Save View
    </Button>
  );
}
