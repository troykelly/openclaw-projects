/**
 * Note sharing dialog component.
 * Part of Epic #338, Issue #355
 */

import React, { useState, useCallback } from 'react';
import { Copy, Check, Trash2, Link2, Mail, Users, Globe, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { Separator } from '@/ui/components/ui/separator';
import type { Note, NoteShare, NoteVisibility } from '../types';

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
  shares?: NoteShare[];
  onAddShare?: (email: string, permission: 'view' | 'edit') => Promise<void>;
  onRemoveShare?: (shareId: string) => Promise<void>;
  onUpdateVisibility?: (visibility: NoteVisibility) => Promise<void>;
  shareUrl?: string;
  className?: string;
}

export function ShareDialog({ open, onOpenChange, note, shares = [], onAddShare, onRemoveShare, onUpdateVisibility, shareUrl, className }: ShareDialogProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setCopying(false);
    }
  }, [shareUrl]);

  const handleAddShare = useCallback(async () => {
    if (!onAddShare || !email.trim()) return;
    setAdding(true);
    try {
      await onAddShare(email.trim(), permission);
      setEmail('');
    } finally {
      setAdding(false);
    }
  }, [onAddShare, email, permission]);

  const handleRemoveShare = useCallback(
    async (shareId: string) => {
      if (!onRemoveShare) return;
      setRemovingId(shareId);
      try {
        await onRemoveShare(shareId);
      } finally {
        setRemovingId(null);
      }
    },
    [onRemoveShare],
  );

  const handleVisibilityChange = useCallback(
    async (newVisibility: NoteVisibility) => {
      if (!onUpdateVisibility || newVisibility === note.visibility) return;
      setUpdatingVisibility(true);
      try {
        await onUpdateVisibility(newVisibility);
      } finally {
        setUpdatingVisibility(false);
      }
    },
    [onUpdateVisibility, note.visibility],
  );

  const getVisibilityIcon = (v: NoteVisibility) => {
    switch (v) {
      case 'private':
        return <Lock className="size-4" />;
      case 'shared':
        return <Users className="size-4" />;
      case 'public':
        return <Globe className="size-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)}>
        <DialogHeader>
          <DialogTitle>Share "{note.title || 'Untitled'}"</DialogTitle>
          <DialogDescription>Control who can access this note</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Visibility setting */}
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={note.visibility} onValueChange={(v) => handleVisibilityChange(v as NoteVisibility)} disabled={updatingVisibility}>
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  {updatingVisibility ? <Loader2 className="size-4 animate-spin" /> : getVisibilityIcon(note.visibility)}
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  <div className="flex items-center gap-2">
                    <Lock className="size-4" />
                    <div>
                      <div>Private</div>
                      <div className="text-xs text-muted-foreground">Only you can access</div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="shared">
                  <div className="flex items-center gap-2">
                    <Users className="size-4" />
                    <div>
                      <div>Shared</div>
                      <div className="text-xs text-muted-foreground">Share with specific people</div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="public">
                  <div className="flex items-center gap-2">
                    <Globe className="size-4" />
                    <div>
                      <div>Public</div>
                      <div className="text-xs text-muted-foreground">Anyone with the link</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Share link (for shared/public) */}
          {note.visibility !== 'private' && shareUrl && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Share link</Label>
                <div className="flex gap-2">
                  <Input value={shareUrl} readOnly className="flex-1 text-xs" />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" onClick={handleCopyLink} disabled={copying}>
                          {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? 'Copied!' : 'Copy link'}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </>
          )}

          {/* Add people (for shared visibility) */}
          {note.visibility === 'shared' && onAddShare && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Share with people</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Enter email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddShare();
                      }
                    }}
                  />
                  <Select value={permission} onValueChange={(v) => setPermission(v as 'view' | 'edit')}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="edit">Edit</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddShare} disabled={adding || !email.trim()}>
                    {adding ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  </Button>
                </div>
              </div>

              {/* Shared with list */}
              {shares.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Shared with {shares.length} {shares.length === 1 ? 'person' : 'people'}
                  </Label>
                  <ScrollArea className="max-h-[140px]">
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div key={share.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                              {share.shared_with_email.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm">{share.shared_with_email}</div>
                              <Badge variant="secondary" className="text-xs">
                                {share.permission === 'edit' ? 'Can edit' : 'Can view'}
                              </Badge>
                            </div>
                          </div>
                          {onRemoveShare && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveShare(share.id)}
                              disabled={removingId === share.id}
                            >
                              {removingId === share.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </>
          )}

          {/* Privacy notice */}
          {note.hide_from_agents && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
              This note is hidden from AI agents regardless of sharing settings.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
