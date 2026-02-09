import * as React from 'react';
import { Inbox, Search, FileText, FolderOpen, Users, Calendar, Mail, Bell, PlusCircle } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';

export type EmptyStateVariant = 'generic' | 'search' | 'inbox' | 'documents' | 'folder' | 'contacts' | 'calendar' | 'email' | 'notifications';

function getEmptyIcon(variant: EmptyStateVariant) {
  switch (variant) {
    case 'search':
      return <Search className="size-12" />;
    case 'inbox':
      return <Inbox className="size-12" />;
    case 'documents':
      return <FileText className="size-12" />;
    case 'folder':
      return <FolderOpen className="size-12" />;
    case 'contacts':
      return <Users className="size-12" />;
    case 'calendar':
      return <Calendar className="size-12" />;
    case 'email':
      return <Mail className="size-12" />;
    case 'notifications':
      return <Bell className="size-12" />;
    default:
      return <Inbox className="size-12" />;
  }
}

function getDefaultContent(variant: EmptyStateVariant): { title: string; description: string } {
  switch (variant) {
    case 'search':
      return {
        title: 'No results found',
        description: 'Try adjusting your search or filter criteria.',
      };
    case 'inbox':
      return {
        title: 'All caught up!',
        description: "You've processed all your items.",
      };
    case 'documents':
      return {
        title: 'No documents yet',
        description: 'Create your first document to get started.',
      };
    case 'folder':
      return {
        title: 'This folder is empty',
        description: 'Add items to this folder to see them here.',
      };
    case 'contacts':
      return {
        title: 'No contacts yet',
        description: 'Add contacts to manage your relationships.',
      };
    case 'calendar':
      return {
        title: 'No events scheduled',
        description: 'Your calendar is clear for now.',
      };
    case 'email':
      return {
        title: 'No emails',
        description: 'No emails linked to this item yet.',
      };
    case 'notifications':
      return {
        title: 'No notifications',
        description: "You're all caught up!",
      };
    default:
      return {
        title: 'Nothing here yet',
        description: 'Get started by creating your first item.',
      };
  }
}

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export function EmptyState({
  variant = 'generic',
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
}: EmptyStateProps) {
  const defaults = getDefaultContent(variant);

  return (
    <div data-testid="empty-state" className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <div className="text-muted-foreground/50">{icon ?? getEmptyIcon(variant)}</div>

      <h3 className="mt-4 text-lg font-semibold">{title ?? defaults.title}</h3>

      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description ?? defaults.description}</p>

      {(onAction || onSecondaryAction) && (
        <div className="mt-6 flex gap-3">
          {onAction && (
            <Button onClick={onAction}>
              <PlusCircle className="mr-2 size-4" />
              {actionLabel ?? 'Create'}
            </Button>
          )}
          {onSecondaryAction && (
            <Button variant="outline" onClick={onSecondaryAction}>
              {secondaryActionLabel ?? 'Learn more'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// First-time user guidance component
export interface FirstTimeGuidanceProps {
  title: string;
  description: string;
  steps?: Array<{
    title: string;
    description: string;
    icon?: React.ReactNode;
  }>;
  onGetStarted?: () => void;
  onSkip?: () => void;
  className?: string;
}

export function FirstTimeGuidance({ title, description, steps, onGetStarted, onSkip, className }: FirstTimeGuidanceProps) {
  return (
    <div data-testid="first-time-guidance" className={cn('rounded-lg border border-primary/20 bg-primary/5 p-6 text-center', className)}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-muted-foreground">{description}</p>

      {steps && steps.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div key={i} className="rounded-lg bg-background p-4">
              {step.icon && <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">{step.icon}</div>}
              <h4 className="font-medium">{step.title}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      )}

      {(onGetStarted || onSkip) && (
        <div className="mt-6 flex justify-center gap-3">
          {onGetStarted && <Button onClick={onGetStarted}>Get Started</Button>}
          {onSkip && (
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
