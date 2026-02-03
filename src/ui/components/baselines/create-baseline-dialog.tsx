/**
 * Dialog for creating a new baseline snapshot
 * Issue #391: Implement baseline snapshots for progress tracking
 */
import * as React from 'react';
import { Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';

export interface CreateBaselineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
  onCreateBaseline: (data: { name: string; description?: string }) => void;
}

function getDefaultBaselineName(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };
  return `Baseline - ${now.toLocaleDateString('en-US', options)}`;
}

export function CreateBaselineDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
  onCreateBaseline,
}: CreateBaselineDialogProps) {
  const defaultName = React.useMemo(() => getDefaultBaselineName(), []);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const baselineName = name.trim() || defaultName;
    onCreateBaseline({
      name: baselineName,
      description: description.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Baseline</DialogTitle>
          <DialogDescription>
            Save the current state of "{projectTitle}" as a baseline for tracking
            progress.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="baseline-name">Name</Label>
              <Input
                id="baseline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseline-description">Description</Label>
              <Textarea
                id="baseline-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of this baseline..."
                rows={3}
              />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>
                This baseline will capture:
              </p>
              <ul className="mt-2 list-disc list-inside space-y-1">
                <li>All tasks and their hierarchy</li>
                <li>Start and end dates</li>
                <li>Estimates and current status</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" />
              Create Baseline
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
