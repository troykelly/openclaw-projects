import * as React from 'react';
import { useState, useCallback } from 'react';
import { Bold, Italic, List, ListOrdered, Link2, Code, Eye, Edit3 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Badge } from '@/ui/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ui/components/ui/tabs';
import type { MemoryItem, MemoryFormData } from './types';

export interface MemoryEditorProps {
  memory?: MemoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: MemoryFormData) => void;
  className?: string;
}

export function MemoryEditor({
  memory,
  open,
  onOpenChange,
  onSubmit,
  className,
}: MemoryEditorProps) {
  const [title, setTitle] = useState(memory?.title ?? '');
  const [content, setContent] = useState(memory?.content ?? '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(memory?.tags ?? []);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const insertMarkdown = useCallback((before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end);

    const newContent =
      content.slice(0, start) +
      before +
      (selected || 'text') +
      after +
      content.slice(end);

    setContent(newContent);

    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      const newStart = start + before.length;
      const newEnd = newStart + (selected || 'text').length;
      textarea.setSelectionRange(newStart, newEnd);
    }, 0);
  }, [content]);

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: title.trim(),
      content: content.trim(),
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  const isValid = title.trim() && content.trim();

  // Simple markdown to HTML conversion for preview
  const renderPreview = (text: string) => {
    return text
      .split('\n')
      .map((line, i) => {
        // Headers
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-lg font-semibold mt-4 mb-2">{line.slice(4)}</h3>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={i} className="text-xl font-semibold mt-4 mb-2">{line.slice(3)}</h2>;
        }
        if (line.startsWith('# ')) {
          return <h1 key={i} className="text-2xl font-bold mt-4 mb-2">{line.slice(2)}</h1>;
        }

        // List items
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return <li key={i} className="ml-4">{line.slice(2)}</li>;
        }

        // Numbered list
        if (/^\d+\. /.test(line)) {
          return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
        }

        // Empty line
        if (!line.trim()) {
          return <br key={i} />;
        }

        // Regular paragraph
        return <p key={i} className="my-1">{line}</p>;
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-2xl', className)}>
        <DialogHeader>
          <DialogTitle>{memory ? 'Edit Memory' : 'Create Memory'}</DialogTitle>
          <DialogDescription className="sr-only">{memory ? 'Edit memory details' : 'Create a new memory entry'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label htmlFor="memory-title" className="text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="memory-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              required
            />
          </div>

          {/* Content with tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Content <span className="text-destructive">*</span>
              </label>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'edit' | 'preview')}>
              <div className="flex items-center justify-between">
                {/* Toolbar */}
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('**', '**')}
                    title="Bold"
                  >
                    <Bold className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('*', '*')}
                    title="Italic"
                  >
                    <Italic className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('- ')}
                    title="Bullet list"
                  >
                    <List className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('1. ')}
                    title="Numbered list"
                  >
                    <ListOrdered className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('[', '](url)')}
                    title="Link"
                  >
                    <Link2 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => insertMarkdown('`', '`')}
                    title="Code"
                  >
                    <Code className="size-4" />
                  </Button>
                </div>

                <TabsList>
                  <TabsTrigger value="edit" className="gap-1">
                    <Edit3 className="size-3" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="gap-1">
                    <Eye className="size-3" />
                    Preview
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="edit" className="mt-2">
                <Textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your memory content here... (Markdown supported)"
                  className="min-h-[200px] font-mono text-sm"
                  required
                />
              </TabsContent>

              <TabsContent value="preview" className="mt-2">
                <div className="min-h-[200px] rounded-md border bg-muted/30 p-4 text-sm">
                  {content ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      {renderPreview(content)}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Nothing to preview</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label htmlFor="memory-tags" className="text-sm font-medium">
              Tags
            </label>
            <div className="flex gap-2">
              <Input
                id="memory-tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={handleAddTag}>
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => handleRemoveTag(tag)}
                  >
                    {tag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              {memory ? 'Save Changes' : 'Create Memory'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
