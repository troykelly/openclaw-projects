/**
 * List component that renders items in groups
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { GroupHeader } from './group-header';
import { groupItems } from './group-utils';
import type { GroupedListProps } from './types';

export function GroupedList<T extends Record<string, unknown>>({
  items,
  groupBy,
  renderItem,
  collapsedGroups: controlledCollapsed,
  onToggleGroup,
  hideEmptyGroups = false,
  className,
}: GroupedListProps<T>) {
  // Internal collapsed state if not controlled
  const [internalCollapsed, setInternalCollapsed] = React.useState<Set<string>>(new Set());

  const collapsedGroups = controlledCollapsed ?? internalCollapsed;

  const handleToggle = React.useCallback(
    (key: string) => {
      if (onToggleGroup) {
        onToggleGroup(key);
      } else {
        setInternalCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
      }
    },
    [onToggleGroup],
  );

  const groups = React.useMemo(() => groupItems(items, groupBy), [items, groupBy]);

  const filteredGroups = React.useMemo(() => {
    if (!hideEmptyGroups) return groups;
    return groups.filter((g) => g.items.length > 0);
  }, [groups, hideEmptyGroups]);

  // If no grouping, render items directly
  if (groupBy === 'none') {
    return <div className={cn('space-y-2', className)}>{items.map((item) => renderItem(item))}</div>;
  }

  return (
    <div className={cn('space-y-4', className)}>
      {filteredGroups.map((group) => {
        const isExpanded = !collapsedGroups.has(group.key);

        return (
          <div key={group.key} className="space-y-2">
            <GroupHeader label={group.label} count={group.items.length} isExpanded={isExpanded} onToggle={() => handleToggle(group.key)} />
            {isExpanded && <div className="pl-6 space-y-2">{group.items.map((item) => renderItem(item))}</div>}
          </div>
        );
      })}
    </div>
  );
}
