/**
 * Dialog for adding a relationship
 * Issue #395: Implement contact relationship types
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { Contact, RelationshipType, RelationshipStrength, RelationshipDirection, NewRelationshipData } from './types';
import { RELATIONSHIP_TYPES, CATEGORY_LABELS, getRelationshipLabel, CATEGORY_COLORS, STRENGTH_LABELS, DIRECTION_LABELS } from './relationship-utils';

export interface AddRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentContactId: string;
  availableContacts: Contact[];
  onAddRelationship: (data: NewRelationshipData) => void;
}

export function AddRelationshipDialog({ open, onOpenChange, currentContactId, availableContacts, onAddRelationship }: AddRelationshipDialogProps) {
  const [selectedContactId, setSelectedContactId] = React.useState<string | null>(null);
  const [selectedType, setSelectedType] = React.useState<RelationshipType>('colleague');
  const [strength, setStrength] = React.useState<RelationshipStrength>('medium');
  const [direction, setDirection] = React.useState<RelationshipDirection>('bidirectional');
  const [notes, setNotes] = React.useState('');

  // Filter out current contact
  const filteredContacts = React.useMemo(() => availableContacts.filter((c) => c.id !== currentContactId), [availableContacts, currentContactId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContactId) return;

    onAddRelationship({
      contact_id: currentContactId,
      relatedContactId: selectedContactId,
      type: selectedType,
      strength,
      direction,
      notes: notes || undefined,
    });

    // Reset form
    setSelectedContactId(null);
    setSelectedType('colleague');
    setStrength('medium');
    setDirection('bidirectional');
    setNotes('');
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
            <DialogDescription>Create a relationship between contacts.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Contact selector */}
            <div className="space-y-2">
              <Label>Select Contact</Label>
              <ScrollArea className="h-32 border rounded-md">
                <div className="p-1" role="listbox">
                  {filteredContacts.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      role="option"
                      aria-selected={selectedContactId === contact.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left',
                        'hover:bg-muted transition-colors',
                        selectedContactId === contact.id && 'bg-muted',
                      )}
                      onClick={() => setSelectedContactId(contact.id)}
                    >
                      <span className="font-medium">{contact.name}</span>
                      {contact.email && <span className="text-muted-foreground text-xs">{contact.email}</span>}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Relationship type selector */}
            <div className="space-y-2">
              <Label>Relationship Type</Label>
              <div className="space-y-3">
                {(Object.entries(RELATIONSHIP_TYPES) as [string, RelationshipType[]][]).map(([category, types]) => (
                  <div key={category}>
                    <div className="text-xs font-medium text-muted-foreground mb-1">{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}</div>
                    <div className="flex flex-wrap gap-1">
                      {types.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={cn(
                            'px-2 py-1 text-xs rounded-full transition-colors',
                            selectedType === type ? CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] : 'bg-muted hover:bg-muted/80',
                          )}
                          onClick={() => setSelectedType(type)}
                        >
                          {getRelationshipLabel(type)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strength selector */}
            <div className="space-y-2">
              <Label>Strength</Label>
              <div className="flex gap-2">
                {(['strong', 'medium', 'weak'] as RelationshipStrength[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={cn(
                      'flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors',
                      strength === s ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                    )}
                    onClick={() => setStrength(s)}
                  >
                    {STRENGTH_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction selector */}
            <div className="space-y-2">
              <Label>Direction</Label>
              <div className="flex gap-2">
                {(['bidirectional', 'outgoing', 'incoming'] as RelationshipDirection[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cn(
                      'flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors',
                      direction === d ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                    )}
                    onClick={() => setDirection(d)}
                  >
                    {DIRECTION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Add notes about this relationship..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedContactId}>
              Add Relationship
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
