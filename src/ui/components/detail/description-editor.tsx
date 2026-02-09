import * as React from 'react';
import { useState } from 'react';
import { Pencil, Check, X, Eye, Edit2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Textarea } from '@/ui/components/ui/textarea';

export interface DescriptionEditorProps {
  description?: string;
  onDescriptionChange?: (description: string) => void;
  className?: string;
}

export function DescriptionEditor({ description, onDescriptionChange, className }: DescriptionEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(description || '');
  const [showPreview, setShowPreview] = useState(false);

  const handleStartEdit = () => {
    setEditValue(description || '');
    setIsEditing(true);
    setShowPreview(false);
  };

  const handleSave = () => {
    onDescriptionChange?.(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(description || '');
    setIsEditing(false);
    setShowPreview(false);
  };

  // Simple markdown to React elements (safe - no dangerouslySetInnerHTML)
  const renderMarkdown = (text: string): React.ReactNode => {
    if (!text) return null;

    const lines = text.split('\n');
    return lines.map((line, i) => {
      // Headers
      if (line.startsWith('### ')) {
        return (
          <h4 key={i} className="mt-4 mb-2 text-sm font-semibold">
            {line.slice(4)}
          </h4>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h3 key={i} className="mt-4 mb-2 font-semibold">
            {line.slice(3)}
          </h3>
        );
      }
      if (line.startsWith('# ')) {
        return (
          <h2 key={i} className="mt-4 mb-2 text-lg font-semibold">
            {line.slice(2)}
          </h2>
        );
      }
      // Lists
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={i} className="ml-4">
            {line.slice(2)}
          </li>
        );
      }
      // Empty line
      if (!line.trim()) {
        return <br key={i} />;
      }

      // Parse inline formatting into React elements
      const parseInline = (text: string): React.ReactNode[] => {
        const result: React.ReactNode[] = [];
        let remaining = text;
        let keyIndex = 0;

        while (remaining.length > 0) {
          // Check for code
          const codeMatch = remaining.match(/^`([^`]+)`/);
          if (codeMatch) {
            result.push(
              <code key={keyIndex++} className="rounded bg-muted px-1 text-sm">
                {codeMatch[1]}
              </code>,
            );
            remaining = remaining.slice(codeMatch[0].length);
            continue;
          }

          // Check for bold
          const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
          if (boldMatch) {
            result.push(<strong key={keyIndex++}>{boldMatch[1]}</strong>);
            remaining = remaining.slice(boldMatch[0].length);
            continue;
          }

          // Check for italic
          const italicMatch = remaining.match(/^\*([^*]+)\*/);
          if (italicMatch) {
            result.push(<em key={keyIndex++}>{italicMatch[1]}</em>);
            remaining = remaining.slice(italicMatch[0].length);
            continue;
          }

          // Take next character as plain text
          const nextSpecial = remaining.search(/[`*]/);
          if (nextSpecial === -1) {
            result.push(remaining);
            break;
          } else if (nextSpecial === 0) {
            // Special char but didn't match pattern, take as literal
            result.push(remaining[0]);
            remaining = remaining.slice(1);
          } else {
            result.push(remaining.slice(0, nextSpecial));
            remaining = remaining.slice(nextSpecial);
          }
        }

        return result;
      };

      return (
        <p key={i} className="my-1">
          {parseInline(line)}
        </p>
      );
    });
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Description</h3>
        {!isEditing && onDescriptionChange && (
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleStartEdit}>
            <Pencil className="size-3" />
            Edit
          </Button>
        )}
        {isEditing && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className={cn('h-7 gap-1', !showPreview && 'bg-muted')} onClick={() => setShowPreview(false)}>
              <Edit2 className="size-3" />
              Edit
            </Button>
            <Button variant="ghost" size="sm" className={cn('h-7 gap-1', showPreview && 'bg-muted')} onClick={() => setShowPreview(true)}>
              <Eye className="size-3" />
              Preview
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="space-y-3">
          {showPreview ? (
            <div className="min-h-32 rounded-md border bg-muted/30 p-3 text-sm">
              {editValue ? renderMarkdown(editValue) : <p className="text-muted-foreground">Nothing to preview</p>}
            </div>
          ) : (
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="Add a description... (Markdown supported)"
              className="min-h-32 font-mono text-sm"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="mr-1 size-3" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Check className="mr-1 size-3" />
              Save
            </Button>
          </div>
        </div>
      ) : description ? (
        <div className="prose prose-sm max-w-none rounded-md bg-muted/30 p-3">{renderMarkdown(description)}</div>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">No description</p>
      )}
    </div>
  );
}
