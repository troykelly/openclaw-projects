/**
 * Filter panel for relationships
 * Issue #395: Implement contact relationship types
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import type { RelationshipType, RelationshipStrength, RelationshipCategory } from './types';
import {
  RELATIONSHIP_TYPES,
  CATEGORY_LABELS,
  getRelationshipLabel,
  CATEGORY_COLORS,
  STRENGTH_LABELS,
} from './relationship-utils';

export interface RelationshipFilterProps {
  selectedTypes: RelationshipType[];
  selectedStrengths: RelationshipStrength[];
  onTypeChange: (types: RelationshipType[]) => void;
  onStrengthChange: (strengths: RelationshipStrength[]) => void;
  className?: string;
}

export function RelationshipFilter({
  selectedTypes,
  selectedStrengths,
  onTypeChange,
  onStrengthChange,
  className,
}: RelationshipFilterProps) {
  const hasFilters = selectedTypes.length > 0 || selectedStrengths.length > 0;

  const toggleType = (type: RelationshipType) => {
    if (selectedTypes.includes(type)) {
      onTypeChange(selectedTypes.filter((t) => t !== type));
    } else {
      onTypeChange([...selectedTypes, type]);
    }
  };

  const toggleStrength = (strength: RelationshipStrength) => {
    if (selectedStrengths.includes(strength)) {
      onStrengthChange(selectedStrengths.filter((s) => s !== strength));
    } else {
      onStrengthChange([...selectedStrengths, strength]);
    }
  };

  const clearFilters = () => {
    onTypeChange([]);
    onStrengthChange([]);
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with clear button */}
      {hasFilters && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={clearFilters}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Relationship type filter */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-muted-foreground">Relationship Type</div>

        {(Object.entries(RELATIONSHIP_TYPES) as [RelationshipCategory, RelationshipType[]][]).map(
          ([category, types]) => (
            <div key={category}>
              <div className="text-xs font-medium mb-1">
                {CATEGORY_LABELS[category]}
              </div>
              <div className="flex flex-wrap gap-1">
                {types.map((type) => {
                  const isSelected = selectedTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      data-selected={isSelected}
                      className={cn(
                        'px-2 py-0.5 text-xs rounded-full transition-colors',
                        isSelected
                          ? CATEGORY_COLORS[category]
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      onClick={() => toggleType(type)}
                    >
                      {getRelationshipLabel(type)}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      {/* Strength filter */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Strength</div>
        <div className="flex flex-wrap gap-1">
          {(['strong', 'medium', 'weak'] as RelationshipStrength[]).map((strength) => {
            const isSelected = selectedStrengths.includes(strength);
            return (
              <button
                key={strength}
                type="button"
                data-selected={isSelected}
                className={cn(
                  'px-2 py-0.5 text-xs rounded-full transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                )}
                onClick={() => toggleStrength(strength)}
              >
                {STRENGTH_LABELS[strength]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
