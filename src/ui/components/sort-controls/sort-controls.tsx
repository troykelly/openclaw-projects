import * as React from 'react';
import { useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/ui/components/ui/dropdown-menu';
import type { SortControlsProps, SortField, SortFieldConfig, SortState } from './types';

// Default sort field configurations
const DEFAULT_FIELDS: SortFieldConfig[] = [
  { field: 'title', label: 'Title', defaultDirection: 'asc' },
  { field: 'created', label: 'Created', defaultDirection: 'desc' },
  { field: 'updated', label: 'Updated', defaultDirection: 'desc' },
  { field: 'dueDate', label: 'Due Date', defaultDirection: 'asc' },
  { field: 'priority', label: 'Priority', defaultDirection: 'desc' },
  { field: 'status', label: 'Status', defaultDirection: 'asc' },
  { field: 'estimate', label: 'Estimate', defaultDirection: 'desc' },
];

function getFieldLabel(field: SortField, configs: SortFieldConfig[]): string {
  return configs.find((c) => c.field === field)?.label ?? field;
}

function getFieldDefaultDirection(field: SortField, configs: SortFieldConfig[]) {
  return configs.find((c) => c.field === field)?.defaultDirection ?? 'asc';
}

export function SortControls({
  sort,
  onSortChange,
  fields,
  showSecondarySort = false,
  className,
  compact = false,
}: SortControlsProps) {
  // Build field configs from props or defaults
  const fieldConfigs = fields
    ? DEFAULT_FIELDS.filter((f) => fields.includes(f.field))
    : DEFAULT_FIELDS;

  const handleFieldSelect = useCallback(
    (field: SortField) => {
      const defaultDirection = getFieldDefaultDirection(field, fieldConfigs);
      onSortChange({
        ...sort,
        field,
        // Use default direction when changing field, keep current if same field
        direction: field === sort.field ? sort.direction : defaultDirection,
      });
    },
    [sort, onSortChange, fieldConfigs]
  );

  const handleDirectionToggle = useCallback(() => {
    onSortChange({
      ...sort,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    });
  }, [sort, onSortChange]);

  const handleSecondaryFieldSelect = useCallback(
    (field: SortField) => {
      onSortChange({
        ...sort,
        secondaryField: field,
        secondaryDirection: getFieldDefaultDirection(field, fieldConfigs),
      });
    },
    [sort, onSortChange, fieldConfigs]
  );

  const handleClearSecondary = useCallback(() => {
    const { secondaryField, secondaryDirection, ...rest } = sort;
    onSortChange(rest as SortState);
  }, [sort, onSortChange]);

  const DirectionIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div
      data-testid="sort-controls"
      className={cn('flex items-center gap-1', className)}
    >
      {/* Sort field dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={compact ? 'sm' : 'default'}
            className={cn('gap-1', compact && 'h-7 px-2 text-xs')}
            aria-label="Sort by"
          >
            <ArrowUpDown className={cn('size-4', compact && 'size-3')} />
            {!compact && <span className="text-muted-foreground">Sort by</span>}
            <span className="font-medium">{getFieldLabel(sort.field, fieldConfigs)}</span>
            <ChevronDown className={cn('size-4', compact && 'size-3')} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {fieldConfigs.map((config) => (
            <DropdownMenuItem
              key={config.field}
              onClick={() => handleFieldSelect(config.field)}
              data-checked={sort.field === config.field}
              className="flex items-center justify-between gap-2"
            >
              {config.label}
              {sort.field === config.field && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Direction toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-8', compact && 'size-7')}
        onClick={handleDirectionToggle}
        aria-label={`Toggle sort direction, currently ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
      >
        <DirectionIcon
          className={cn('size-4', compact && 'size-3')}
          aria-label={sort.direction === 'asc' ? 'ascending' : 'descending'}
        />
      </Button>

      {/* Secondary sort */}
      {showSecondarySort && (
        <>
          <span className="text-xs text-muted-foreground mx-1">then by</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size={compact ? 'sm' : 'default'}
                className={cn('gap-1', compact && 'h-7 px-2 text-xs')}
                aria-label="Then by"
              >
                <span className={sort.secondaryField ? 'font-medium' : 'text-muted-foreground'}>
                  {sort.secondaryField
                    ? getFieldLabel(sort.secondaryField, fieldConfigs)
                    : 'None'}
                </span>
                <ChevronDown className={cn('size-4', compact && 'size-3')} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={handleClearSecondary}
                data-checked={!sort.secondaryField}
              >
                None
                {!sort.secondaryField && <Check className="size-4 ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {fieldConfigs
                .filter((c) => c.field !== sort.field)
                .map((config) => (
                  <DropdownMenuItem
                    key={config.field}
                    onClick={() => handleSecondaryFieldSelect(config.field)}
                    data-checked={sort.secondaryField === config.field}
                    className="flex items-center justify-between gap-2"
                  >
                    {config.label}
                    {sort.secondaryField === config.field && (
                      <Check className="size-4" />
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Secondary direction toggle */}
          {sort.secondaryField && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-8', compact && 'size-7')}
              onClick={() =>
                onSortChange({
                  ...sort,
                  secondaryDirection:
                    sort.secondaryDirection === 'asc' ? 'desc' : 'asc',
                })
              }
              aria-label="Toggle secondary sort direction"
            >
              {sort.secondaryDirection === 'asc' ? (
                <ArrowUp className={cn('size-4', compact && 'size-3')} />
              ) : (
                <ArrowDown className={cn('size-4', compact && 'size-3')} />
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
