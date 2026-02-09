/**
 * Dialog for creating/editing milestones
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import type { MilestoneDialogProps, CreateMilestoneData } from './types';

export function MilestoneDialog({ open, projectId, milestone, onSave, onCancel }: MilestoneDialogProps) {
  const isEdit = !!milestone;
  const [name, setName] = React.useState(milestone?.name || '');
  const [targetDate, setTargetDate] = React.useState(milestone?.targetDate || '');
  const [description, setDescription] = React.useState(milestone?.description || '');

  React.useEffect(() => {
    if (milestone) {
      setName(milestone.name);
      setTargetDate(milestone.targetDate);
      setDescription(milestone.description || '');
    } else {
      setName('');
      setTargetDate('');
      setDescription('');
    }
  }, [milestone]);

  const canSave = name.trim() && targetDate;

  const handleSave = () => {
    if (!canSave) return;

    const data: CreateMilestoneData = {
      name: name.trim(),
      targetDate,
      description: description.trim() || undefined,
    };

    onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Milestone' : 'Create Milestone'}</DialogTitle>
          <DialogDescription>{isEdit ? 'Update the milestone details.' : 'Create a new milestone to track major deliverables.'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="milestone-name">Name</Label>
            <Input id="milestone-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Q1 Release, MVP Launch" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-date">Target Date</Label>
            <Input id="milestone-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-description">Description (optional)</Label>
            <Textarea
              id="milestone-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this milestone represents..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
