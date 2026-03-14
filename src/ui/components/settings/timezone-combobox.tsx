/**
 * Searchable timezone combobox using the full IANA timezone list.
 *
 * Uses shadcn Popover + Command pattern with Intl.supportedValuesOf('timeZone').
 * Grouped by region prefix, searchable across all groups.
 *
 * @see Issue #2513 — Epic #2509
 */
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/components/ui/popover';
import { cn } from '@/ui/lib/utils';
import {
  getAllTimezones,
  groupTimezones,
  formatTimezoneDisplay,
  canonicalizeTimezone,
} from './timezone-utils';

export interface TimezoneComboboxProps {
  /** Currently selected timezone (IANA string). */
  value: string;
  /** Called when a timezone is selected. */
  onValueChange: (timezone: string) => void;
}

export function TimezoneCombobox({ value, onValueChange }: TimezoneComboboxProps) {
  const [open, setOpen] = useState(false);

  const canonicalValue = useMemo(() => canonicalizeTimezone(value), [value]);

  const grouped = useMemo(() => {
    const timezones = getAllTimezones();
    return groupTimezones(timezones);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[240px] justify-between"
          data-testid="timezone-combobox-trigger"
        >
          <span className="truncate">
            {formatTimezoneDisplay(canonicalValue)}
          </span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {grouped.map(([region, zones]) => (
              <CommandGroup key={region} heading={region}>
                {zones.map((tz) => (
                  <CommandItem
                    key={tz}
                    value={tz}
                    onSelect={() => {
                      onValueChange(tz);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'me-2 size-4',
                        canonicalValue === tz ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {formatTimezoneDisplay(tz)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
