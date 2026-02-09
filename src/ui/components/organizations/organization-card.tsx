/**
 * Organization card component
 * Issue #394: Implement contact groups and organization hierarchy
 */
import * as React from 'react';
import { Building2, Users, Globe } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { Organization } from './types';

export interface OrganizationCardProps {
  organization: Organization;
  onClick?: (organizationId: string) => void;
  selected?: boolean;
  className?: string;
}

export function OrganizationCard({ organization, onClick, selected = false, className }: OrganizationCardProps) {
  return (
    <button
      className={cn(
        'w-full text-left p-4 rounded-lg border transition-colors',
        'hover:bg-muted/50',
        selected && 'border-primary bg-primary/5',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={() => onClick?.(organization.id)}
    >
      <div className="flex items-start gap-3">
        {/* Logo or placeholder */}
        {organization.logo ? (
          <img src={organization.logo} alt={`${organization.name} logo`} className="w-12 h-12 rounded-lg object-cover" />
        ) : (
          <div data-testid="org-logo-placeholder" className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <Building2 className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Name */}
          <div className="font-medium truncate">{organization.name}</div>

          {/* Domain */}
          {organization.domain && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
              <Globe className="h-3 w-3" />
              <span>{organization.domain}</span>
            </div>
          )}

          {/* Description */}
          {organization.description && <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{organization.description}</div>}

          {/* Contact count */}
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-2">
            <Users className="h-3.5 w-3.5" />
            <span>
              {organization.contactCount} contact{organization.contactCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
