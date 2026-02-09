/**
 * Filter sidebar for organizations and groups
 * Issue #394: Implement contact groups and organization hierarchy
 */
import * as React from 'react';
import { Building2, Tag, Users } from 'lucide-react';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { Organization, ContactGroup } from './types';

export interface OrganizationFilterProps {
  organizations: Organization[];
  groups: ContactGroup[];
  selectedOrganizationId: string | null;
  selectedGroupId: string | null;
  onOrganizationChange: (organizationId: string | null) => void;
  onGroupChange: (groupId: string | null) => void;
  className?: string;
}

export function OrganizationFilter({
  organizations,
  groups,
  selectedOrganizationId,
  selectedGroupId,
  onOrganizationChange,
  onGroupChange,
  className,
}: OrganizationFilterProps) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Organizations */}
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
          <Building2 className="h-4 w-4" />
          <span>Organization</span>
        </div>

        <ScrollArea className="max-h-48">
          <div className="space-y-0.5">
            <button
              data-selected={selectedOrganizationId === null}
              className={cn(
                'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm',
                'hover:bg-muted transition-colors text-left',
                selectedOrganizationId === null && 'bg-muted font-medium',
              )}
              onClick={() => onOrganizationChange(null)}
            >
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>All Organizations</span>
              </span>
            </button>

            {organizations.map((org) => (
              <button
                key={org.id}
                data-selected={selectedOrganizationId === org.id}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm',
                  'hover:bg-muted transition-colors text-left',
                  selectedOrganizationId === org.id && 'bg-muted font-medium',
                )}
                onClick={() => onOrganizationChange(org.id)}
              >
                <span className="truncate">{org.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{org.contactCount}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Groups */}
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
          <Tag className="h-4 w-4" />
          <span>Group</span>
        </div>

        <ScrollArea className="max-h-48">
          <div className="space-y-0.5">
            <button
              data-selected={selectedGroupId === null}
              className={cn(
                'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm',
                'hover:bg-muted transition-colors text-left',
                selectedGroupId === null && 'bg-muted font-medium',
              )}
              onClick={() => onGroupChange(null)}
            >
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>All Groups</span>
              </span>
            </button>

            {groups.map((group) => (
              <button
                key={group.id}
                data-selected={selectedGroupId === group.id}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm',
                  'hover:bg-muted transition-colors text-left',
                  selectedGroupId === group.id && 'bg-muted font-medium',
                )}
                onClick={() => onGroupChange(group.id)}
              >
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                  <span className="truncate">{group.name}</span>
                </span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{group.memberCount}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
