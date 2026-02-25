/**
 * Section for displaying and editing custom key-value fields on a contact.
 * Issue #1748: Contact custom fields display
 */
import * as React from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Input } from '@/ui/components/ui/input';
import type { CustomField } from '@/ui/lib/api-types';

export interface CustomFieldsSectionProps {
  fields: CustomField[];
  onSave: (fields: CustomField[]) => void;
  isSubmitting?: boolean;
}

export function CustomFieldsSection({ fields, onSave, isSubmitting = false }: CustomFieldsSectionProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<CustomField[]>([]);

  const startEditing = () => {
    setDraft([...fields]);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft([]);
  };

  const handleSave = () => {
    const cleaned = draft.filter((f) => f.key.trim() && f.value.trim());
    onSave(cleaned);
    setEditing(false);
  };

  const addField = () => {
    setDraft([...draft, { key: '', value: '' }]);
  };

  const removeField = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
  };

  const updateField = (index: number, field: Partial<CustomField>) => {
    const updated = [...draft];
    updated[index] = { ...updated[index], ...field };
    setDraft(updated);
  };

  if (editing) {
    return (
      <div className="space-y-3" data-testid="custom-fields-editor">
        {draft.map((field, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              placeholder="Key"
              value={field.key}
              onChange={(e) => updateField(idx, { key: e.target.value })}
              className="flex-1"
              data-testid="custom-field-key-input"
            />
            <Input
              placeholder="Value"
              value={field.value}
              onChange={(e) => updateField(idx, { value: e.target.value })}
              className="flex-1"
              data-testid="custom-field-value-input"
            />
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => removeField(idx)}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addField} data-testid="add-custom-field">
          <Plus className="mr-1 size-3" />
          Add Field
        </Button>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={cancelEditing}>
            <X className="mr-1 size-3" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSubmitting} data-testid="save-custom-fields">
            Save
          </Button>
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <p className="text-sm">No custom fields</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={startEditing} data-testid="add-first-custom-field">
          <Plus className="mr-1 size-3" />
          Add Custom Fields
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="custom-fields-display">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Custom Fields</h3>
        <Button variant="ghost" size="sm" onClick={startEditing} data-testid="edit-custom-fields">
          <Pencil className="mr-1 size-3" />
          Edit
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field, idx) => (
          <Card key={idx}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{field.key}</p>
              <p className="text-sm font-medium mt-0.5">{field.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
