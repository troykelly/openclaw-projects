import * as React from 'react';
import { useState } from 'react';
import { Mail, Calendar } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/ui/components/ui/dialog';

export interface LinkCommunicationDialogProps {
  type: 'email' | 'calendar';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: string) => void;
}

export function LinkCommunicationDialog({ type, open, onOpenChange, onSubmit }: LinkCommunicationDialogProps) {
  const [id, setId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (id.trim()) {
      onSubmit(id.trim());
      setId('');
    }
  };

  const isEmail = type === 'email';
  const Icon = isEmail ? Mail : Calendar;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" />
            Link {isEmail ? 'Email' : 'Calendar Event'}
          </DialogTitle>
          <DialogDescription>Enter the {isEmail ? 'email' : 'calendar event'} ID to link it to this work item.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="communication-id" className="text-sm font-medium">
              {isEmail ? 'Email' : 'Event'} ID
            </label>
            <Input
              id="communication-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={isEmail ? 'Enter email ID...' : 'Enter event ID...'}
              required
            />
            <p className="text-xs text-muted-foreground">
              {isEmail
                ? 'You can find the email ID in your email provider or integration settings.'
                : 'You can find the event ID in your calendar provider or integration settings.'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!id.trim()}>
              Link {isEmail ? 'Email' : 'Event'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
