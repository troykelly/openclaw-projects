/**
 * Dialog for creating a user-defined dev prompt.
 * Issue #2016.
 */
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { useCreateDevPrompt } from '@/ui/hooks/queries/use-dev-prompts';

const CATEGORIES = [
  { value: 'custom', label: 'Custom' },
  { value: 'identification', label: 'Identification' },
  { value: 'creation', label: 'Creation' },
  { value: 'triage', label: 'Triage' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'general', label: 'General' },
] as const;

export interface CreatePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatePromptDialog({ open, onOpenChange }: CreatePromptDialogProps) {
  const createMutation = useCreateDevPrompt();
  const [title, setTitle] = useState('');
  const [promptKey, setPromptKey] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('custom');
  const [description, setDescription] = useState('');

  const isValid = title.trim() !== '' && promptKey.trim() !== '' && body.trim() !== '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    createMutation.mutate(
      {
        title: title.trim(),
        prompt_key: promptKey.trim(),
        body,
        category,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setTitle('');
          setPromptKey('');
          setBody('');
          setCategory('custom');
          setDescription('');
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="create-prompt-dialog">
        <DialogHeader>
          <DialogTitle>Create Dev Prompt</DialogTitle>
          <DialogDescription>Create a new user-defined prompt template.</DialogDescription>
        </DialogHeader>
        {createMutation.error && (
          <p className="text-sm text-destructive">
            {createMutation.error.message}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="prompt-title">Title</Label>
            <Input
              id="prompt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Custom Bug Report"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prompt-key">Prompt Key</Label>
            <Input
              id="prompt-key"
              value={promptKey}
              onChange={(e) => setPromptKey(e.target.value)}
              placeholder="e.g. custom_bug_report"
              className="font-mono"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="prompt-description">Description</Label>
            <Input
              id="prompt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description (optional)"
            />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="category-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="prompt-body">Body</Label>
            <Textarea
              id="prompt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enter Handlebars template body..."
              className="min-h-[120px] font-mono text-sm"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || createMutation.isPending}
              data-testid="submit-create-prompt"
            >
              Create Prompt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
