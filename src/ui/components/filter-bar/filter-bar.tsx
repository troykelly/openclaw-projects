import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Filter, X, Plus, ChevronDown, Save, User, AlertTriangle, Zap, Calendar, Folder, Check } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Input } from '@/ui/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/ui/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/ui/components/ui/dialog';
import { Checkbox } from '@/ui/components/ui/checkbox';
import type { FilterBarProps, FilterState, FilterField, FilterFieldConfig, QuickFilter, DateRange, DateRangePreset } from './types';

// Default filter field configurations
const DEFAULT_FILTER_FIELDS: FilterFieldConfig[] = [
  {
    field: 'status',
    label: 'Status',
    type: 'multi-select',
    options: [
      { value: 'not_started', label: 'Not Started' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'blocked', label: 'Blocked' },
      { value: 'done', label: 'Done' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  {
    field: 'priority',
    label: 'Priority',
    type: 'multi-select',
    options: [
      { value: 'urgent', label: 'Urgent' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ],
  },
  {
    field: 'kind',
    label: 'Kind',
    type: 'multi-select',
    options: [
      { value: 'project', label: 'Project' },
      { value: 'initiative', label: 'Initiative' },
      { value: 'epic', label: 'Epic' },
      { value: 'issue', label: 'Issue' },
    ],
  },
  {
    field: 'assignee',
    label: 'Assignee',
    type: 'multi-select',
    options: [
      { value: 'me', label: 'Me' },
      { value: 'unassigned', label: 'Unassigned' },
    ],
  },
  {
    field: 'dueDate',
    label: 'Due Date',
    type: 'date-range',
  },
  {
    field: 'hasDescription',
    label: 'Has Description',
    type: 'boolean',
  },
  {
    field: 'hasEstimate',
    label: 'Has Estimate',
    type: 'boolean',
  },
];

// Default quick filters
const DEFAULT_QUICK_FILTERS: QuickFilter[] = [
  {
    id: 'my-items',
    label: 'My Items',
    filters: { assignee: ['me'] },
    icon: <User className="size-3" />,
  },
  {
    id: 'overdue',
    label: 'Overdue',
    filters: { dueDate: 'overdue' },
    icon: <AlertTriangle className="size-3" />,
  },
  {
    id: 'high-priority',
    label: 'High Priority',
    filters: { priority: ['high', 'urgent'] },
    icon: <Zap className="size-3" />,
  },
];

function isFilterEmpty(filters: FilterState): boolean {
  return Object.keys(filters).every((key) => {
    const value = filters[key as keyof FilterState];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'boolean') return false; // Booleans are always "set"
    return value === undefined || value === null;
  });
}

function isQuickFilterActive(quickFilter: QuickFilter, currentFilters: FilterState): boolean {
  return Object.entries(quickFilter.filters).every(([key, value]) => {
    const current = currentFilters[key as keyof FilterState];
    if (Array.isArray(value) && Array.isArray(current)) {
      return value.every((v) => current.includes(v)) && current.every((c) => value.includes(c));
    }
    return current === value;
  });
}

function getFilterLabel(field: FilterField, value: unknown, config?: FilterFieldConfig): string {
  if (Array.isArray(value)) {
    const options = config?.options || [];
    const labels = value.map((v) => options.find((o) => o.value === v)?.label || v);
    return labels.join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    if (config?.options) {
      return config.options.find((o) => o.value === value)?.label || value;
    }
    return value;
  }
  return String(value);
}

interface FilterChipProps {
  field: FilterField;
  label: string;
  value: string;
  onRemove: () => void;
}

function FilterChip({ field, label, value, onRemove }: FilterChipProps) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
      <Button variant="ghost" size="icon" className="size-4 p-0 hover:bg-transparent" onClick={onRemove} aria-label={`Remove ${field} filter`}>
        <X className="size-3" />
      </Button>
    </Badge>
  );
}

interface MultiSelectPopoverProps {
  field: FilterField;
  config: FilterFieldConfig;
  value: string[];
  onChange: (value: string[]) => void;
  onClose: () => void;
}

function MultiSelectPopover({ field, config, value, onChange, onClose }: MultiSelectPopoverProps) {
  const [localValue, setLocalValue] = useState(value || []);

  const toggleOption = (optionValue: string) => {
    setLocalValue((prev) => (prev.includes(optionValue) ? prev.filter((v) => v !== optionValue) : [...prev, optionValue]));
  };

  const handleApply = () => {
    onChange(localValue);
    onClose();
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Select {config.label}</p>
      <div className="space-y-1">
        {config.options?.map((option) => (
          <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted cursor-pointer">
            <Checkbox checked={localValue.includes(option.value)} onCheckedChange={() => toggleOption(option.value)} />
            <span className="text-sm">{option.label}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export interface DateRangePopoverProps {
  field: FilterField;
  config: FilterFieldConfig;
  value: DateRange | string | undefined;
  onChange: (value: DateRange | undefined) => void;
  onClose: () => void;
}

export function DateRangePopover({ field, config, value, onChange, onClose }: DateRangePopoverProps) {
  // Parse initial value - could be a DateRange object or a preset string like 'overdue'
  const initialRange: DateRange = typeof value === 'string' ? { preset: value as DateRangePreset } : value || {};

  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset | undefined>(initialRange.preset);
  const [fromDate, setFromDate] = useState(initialRange.from || '');
  const [toDate, setToDate] = useState(initialRange.to || '');

  const presets: { value: DateRangePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'this_week', label: 'This Week' },
    { value: 'this_month', label: 'This Month' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'upcoming', label: 'Upcoming' },
  ];

  const handlePresetClick = (preset: DateRangePreset) => {
    setSelectedPreset(preset);
    setFromDate('');
    setToDate('');
  };

  const handleApply = () => {
    if (selectedPreset && selectedPreset !== 'custom') {
      onChange({ preset: selectedPreset });
    } else if (fromDate || toDate) {
      onChange({ preset: 'custom', from: fromDate || undefined, to: toDate || undefined });
    } else {
      onChange(undefined);
    }
    onClose();
  };

  return (
    <div className="space-y-2" data-testid="date-range-popover">
      <p className="text-sm font-medium">{config.label}</p>
      <div className="space-y-1">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted cursor-pointer',
              selectedPreset === preset.value && 'bg-muted font-medium',
            )}
            onClick={() => handlePresetClick(preset.value)}
          >
            {selectedPreset === preset.value && <Check className="size-3" />}
            {selectedPreset !== preset.value && <span className="size-3" />}
            {preset.label}
          </button>
        ))}
      </div>
      <div className="space-y-2 border-t pt-2">
        <p className="text-xs text-muted-foreground">Custom range</p>
        <div className="flex gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setSelectedPreset('custom');
            }}
            className="flex-1 rounded border px-2 py-1 text-sm"
            aria-label="From date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setSelectedPreset('custom');
            }}
            className="flex-1 rounded border px-2 py-1 text-sm"
            aria-label="To date"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export interface BooleanPopoverProps {
  field: FilterField;
  config: FilterFieldConfig;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  onClose: () => void;
}

export function BooleanPopover({ field, config, value, onChange, onClose }: BooleanPopoverProps) {
  const [localValue, setLocalValue] = useState<boolean | undefined>(value);

  const handleApply = () => {
    onChange(localValue);
    onClose();
  };

  return (
    <div className="space-y-2" data-testid="boolean-popover">
      <p className="text-sm font-medium">{config.label}</p>
      <div className="flex gap-2">
        <Button variant={localValue === true ? 'default' : 'outline'} size="sm" onClick={() => setLocalValue(true)} className="flex-1">
          Yes
        </Button>
        <Button variant={localValue === false ? 'default' : 'outline'} size="sm" onClick={() => setLocalValue(false)} className="flex-1">
          No
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export function FilterBar({
  filters,
  onFiltersChange,
  showQuickFilters = false,
  quickFilters = DEFAULT_QUICK_FILTERS,
  savedFilters = [],
  onSaveFilter,
  onDeleteFilter,
  additionalFields = [],
  hideFields = [],
  className,
}: FilterBarProps) {
  const [openField, setOpenField] = useState<FilterField | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [filterName, setFilterName] = useState('');

  const filterFields = useMemo(() => {
    const baseFields = DEFAULT_FILTER_FIELDS.filter((f) => !hideFields.includes(f.field));
    return [...baseFields, ...additionalFields];
  }, [hideFields, additionalFields]);

  const hasActiveFilters = !isFilterEmpty(filters);

  const handleClearAll = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const handleRemoveFilter = useCallback(
    (field: FilterField) => {
      const newFilters = { ...filters };
      delete newFilters[field];
      onFiltersChange(newFilters);
    },
    [filters, onFiltersChange],
  );

  const handleApplyQuickFilter = useCallback(
    (quickFilter: QuickFilter) => {
      // Toggle if already active
      if (isQuickFilterActive(quickFilter, filters)) {
        // Remove quick filter fields
        const newFilters = { ...filters };
        Object.keys(quickFilter.filters).forEach((key) => {
          delete newFilters[key as keyof FilterState];
        });
        onFiltersChange(newFilters);
      } else {
        onFiltersChange({ ...filters, ...quickFilter.filters });
      }
    },
    [filters, onFiltersChange],
  );

  const handleFieldValueChange = useCallback(
    (field: FilterField, value: unknown) => {
      if (value === undefined || (Array.isArray(value) && value.length === 0)) {
        handleRemoveFilter(field);
      } else {
        onFiltersChange({ ...filters, [field]: value });
      }
      setOpenField(null);
    },
    [filters, onFiltersChange, handleRemoveFilter],
  );

  const handleSaveFilter = useCallback(() => {
    if (filterName.trim() && onSaveFilter) {
      onSaveFilter(filterName.trim(), filters);
      setFilterName('');
      setSaveDialogOpen(false);
    }
  }, [filterName, filters, onSaveFilter]);

  const handleApplySavedFilter = useCallback(
    (savedFilter: { filters: FilterState }) => {
      onFiltersChange(savedFilter.filters);
    },
    [onFiltersChange],
  );

  // Render active filter chips
  const activeFilterChips = Object.entries(filters)
    .filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null;
    })
    .map(([field, value]) => {
      const config = filterFields.find((f) => f.field === field);
      return {
        field: field as FilterField,
        label: config?.label || field,
        value: getFilterLabel(field as FilterField, value, config),
      };
    });

  return (
    <div data-testid="filter-bar" className={cn('flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2', className)}>
      <Filter className="size-4 text-muted-foreground" />

      {/* Quick filters */}
      {showQuickFilters && (
        <div className="flex items-center gap-1">
          {quickFilters.map((qf) => {
            const is_active = isQuickFilterActive(qf, filters);
            return (
              <Button
                key={qf.id}
                variant={is_active ? 'secondary' : 'ghost'}
                size="sm"
                className="gap-1 text-xs"
                onClick={() => handleApplyQuickFilter(qf)}
                data-active={is_active}
              >
                {qf.icon}
                {qf.label}
              </Button>
            );
          })}
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterChips.map((chip) => (
        <FilterChip key={chip.field} field={chip.field} label={chip.label} value={chip.value} onRemove={() => handleRemoveFilter(chip.field)} />
      ))}

      {/* Add filter dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            <Plus className="size-3" />
            Add Filter
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {filterFields.map((field) => (
            <DropdownMenuItem key={field.field} onClick={() => setOpenField(field.field)}>
              {field.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Filter field popovers */}
      {openField && (
        <Popover open onOpenChange={() => setOpenField(null)}>
          <PopoverTrigger asChild>
            <span />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            {(() => {
              const config = filterFields.find((f) => f.field === openField);
              if (!config) return null;

              if (config.type === 'multi-select') {
                return (
                  <MultiSelectPopover
                    field={openField}
                    config={config}
                    value={(filters[openField] as string[]) || []}
                    onChange={(value) => handleFieldValueChange(openField, value)}
                    onClose={() => setOpenField(null)}
                  />
                );
              }

              if (config.type === 'date-range') {
                return (
                  <DateRangePopover
                    field={openField}
                    config={config}
                    value={filters[openField] as DateRange | string | undefined}
                    onChange={(value) => handleFieldValueChange(openField, value)}
                    onClose={() => setOpenField(null)}
                  />
                );
              }

              if (config.type === 'boolean') {
                return (
                  <BooleanPopover
                    field={openField}
                    config={config}
                    value={filters[openField] as boolean | undefined}
                    onChange={(value) => handleFieldValueChange(openField, value)}
                    onClose={() => setOpenField(null)}
                  />
                );
              }

              return null;
            })()}
          </PopoverContent>
        </Popover>
      )}

      <div className="flex-1" />

      {/* Saved filters dropdown */}
      {savedFilters.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              <Folder className="size-3" />
              Saved Filters
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {savedFilters.map((sf) => (
              <DropdownMenuItem key={sf.id} onClick={() => handleApplySavedFilter(sf)}>
                {sf.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Save filter button */}
      {hasActiveFilters && onSaveFilter && (
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setSaveDialogOpen(true)}>
          <Save className="size-3" />
          Save Filter
        </Button>
      )}

      {/* Clear all button */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={handleClearAll}>
          <X className="size-3" />
          Clear All
        </Button>
      )}

      {/* Save filter dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Filter</DialogTitle>
            <DialogDescription>Save the current filter settings for quick access later.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Filter name"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveFilter();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFilter} disabled={!filterName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
