/**
 * Label picker component for selecting and adding labels to work items
 */
import * as React from 'react';
import { PlusIcon, CheckIcon } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import { LabelBadge } from './label-badge';
import type { LabelPickerProps, Label } from './types';

export function LabelPicker({ labels, selectedLabels, onSelect, onDeselect, onCreate, className }: LabelPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedIds = new Set(selectedLabels.map((l) => l.id));

  const filteredLabels = React.useMemo(() => {
    if (!search.trim()) return labels;
    const searchLower = search.toLowerCase();
    return labels.filter((label) => label.name.toLowerCase().includes(searchLower));
  }, [labels, search]);

  const showCreateOption = onCreate && search.trim() && !labels.some((l) => l.name.toLowerCase() === search.trim().toLowerCase());

  const handleSelect = (label: Label) => {
    if (selectedIds.has(label.id)) {
      onDeselect(label);
    } else {
      onSelect(label);
    }
  };

  const handleCreate = () => {
    if (onCreate && search.trim()) {
      onCreate(search.trim());
      setSearch('');
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {selectedLabels.map((label) => (
        <LabelBadge key={label.id} label={label} size="sm" onRemove={onDeselect} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-muted-foreground" aria-label="Add label">
            <PlusIcon className="h-3.5 w-3.5 mr-1" />
            Add label
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <Input placeholder="Search labels..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 mb-2" />
          <ScrollArea className="h-48">
            <div className="space-y-1">
              {filteredLabels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => handleSelect(label)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                    'hover:bg-muted focus:outline-none focus:bg-muted',
                    selectedIds.has(label.id) && 'bg-muted',
                  )}
                >
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                  <span className="flex-1 text-left truncate">{label.name}</span>
                  {selectedIds.has(label.id) && <CheckIcon className="h-4 w-4 text-primary" />}
                </button>
              ))}
              {showCreateOption && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                    'hover:bg-muted focus:outline-none focus:bg-muted',
                    'text-primary',
                  )}
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Create "{search.trim()}"
                </button>
              )}
              {filteredLabels.length === 0 && !showCreateOption && <p className="text-center text-muted-foreground text-sm py-4">No labels found</p>}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
