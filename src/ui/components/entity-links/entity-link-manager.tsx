/**
 * Entity link manager section (Issue #1276).
 *
 * Displays all entity links for a given entity (as source or target)
 * with a "Link to..." button for creating new links.
 */
import { Link2, Plus } from 'lucide-react';
import React, { useState } from 'react';
import { EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { apiClient } from '@/ui/lib/api-client';
import type { CreateEntityLinkBody, EntityLinkRelType, EntityLinkSourceType, EntityLinkTargetType } from '@/ui/lib/api-types';
import { useEntityLinksFromSource, useEntityLinksToTarget } from '@/ui/hooks/queries/use-entity-links';
import { EntityLinkBadge } from './entity-link-badge';

interface EntityLinkManagerProps {
  /** The type of the current entity. */
  entityType: EntityLinkSourceType | EntityLinkTargetType;
  /** The ID of the current entity. */
  entityId: string;
  /** Whether to query as source or target. */
  direction: 'source' | 'target';
  /** Called when a linked entity badge is clicked. */
  onLinkClick?: (entityType: string, entityId: string) => void;
}

export function EntityLinkManager({ entityType, entityId, direction, onLinkClick }: EntityLinkManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const sourceQuery = useEntityLinksFromSource(entityType, entityId);
  const targetQuery = useEntityLinksToTarget(entityType, entityId);
  const query = direction === 'source' ? sourceQuery : targetQuery;
  const links = query.data?.links ?? [];

  const handleRemove = async (linkId: string) => {
    try {
      await apiClient.delete(`/api/entity-links/${linkId}`);
      query.refetch();
    } catch (err) {
      console.error('Failed to remove entity link:', err);
    }
  };

  return (
    <div data-testid="entity-link-manager">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center gap-1">
          <Link2 className="size-4" />
          Linked Entities
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)} data-testid="add-entity-link-button">
          <Plus className="size-3 mr-1" />
          Link
        </Button>
      </div>

      {links.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <EntityLinkBadge
              key={link.id}
              link={link}
              side={direction === 'source' ? 'target' : 'source'}
              onClick={() => {
                const clickType = direction === 'source' ? link.target_type : link.source_type;
                const clickId = direction === 'source' ? link.target_id : link.source_id;
                onLinkClick?.(clickType, clickId);
              }}
              onRemove={() => handleRemove(link.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No linked entities yet.</p>
      )}

      <CreateEntityLinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityType={entityType}
        entityId={entityId}
        direction={direction}
        onCreated={() => query.refetch()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateEntityLinkDialog
// ---------------------------------------------------------------------------

const TARGET_TYPE_OPTIONS: Array<{ value: EntityLinkTargetType; label: string }> = [
  { value: 'project', label: 'Project' },
  { value: 'contact', label: 'Contact' },
  { value: 'todo', label: 'Todo' },
  { value: 'memory', label: 'Memory' },
];

const LINK_TYPE_OPTIONS: Array<{ value: EntityLinkRelType; label: string }> = [
  { value: 'related', label: 'Related' },
  { value: 'caused_by', label: 'Caused by' },
  { value: 'resulted_in', label: 'Resulted in' },
  { value: 'about', label: 'About' },
];

interface CreateEntityLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityId: string;
  direction: 'source' | 'target';
  onCreated: () => void;
}

function CreateEntityLinkDialog({ open, onOpenChange, entityType, entityId, direction, onCreated }: CreateEntityLinkDialogProps) {
  const [targetType, setTargetType] = useState<EntityLinkTargetType>('project');
  const [targetId, setTargetId] = useState('');
  const [linkType, setLinkType] = useState<EntityLinkRelType>('related');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId.trim()) return;

    setIsSubmitting(true);
    try {
      const body: CreateEntityLinkBody =
        direction === 'source'
          ? {
              source_type: entityType as EntityLinkSourceType,
              source_id: entityId,
              target_type: targetType,
              target_id: targetId.trim(),
              link_type: linkType,
            }
          : {
              source_type: targetType as EntityLinkSourceType,
              source_id: targetId.trim(),
              target_type: entityType as EntityLinkTargetType,
              target_id: entityId,
              link_type: linkType,
            };

      await apiClient.post('/api/entity-links', body);
      onCreated();
      onOpenChange(false);
      setTargetId('');
    } catch (err) {
      console.error('Failed to create entity link:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="create-entity-link-dialog">
        <DialogHeader>
          <DialogTitle>Link Entity</DialogTitle>
          <DialogDescription>Create a link to another entity.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="link-target-type" className="text-sm font-medium">
              Entity Type
            </label>
            <select
              id="link-target-type"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as EntityLinkTargetType)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TARGET_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="link-target-id" className="text-sm font-medium">
              Entity ID
            </label>
            <Input id="link-target-id" placeholder="UUID of the entity" value={targetId} onChange={(e) => setTargetId(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <label htmlFor="link-type" className="text-sm font-medium">
              Relationship
            </label>
            <select
              id="link-type"
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as EntityLinkRelType)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {LINK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!targetId.trim() || isSubmitting}>
              Link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
