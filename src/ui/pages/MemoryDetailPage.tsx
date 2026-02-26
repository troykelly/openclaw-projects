/**
 * Memory detail page (/memory/:id).
 *
 * Full detail page showing all metadata, linked contacts, related memories,
 * file attachments, geolocation, and version chain information.
 *
 * Part of Issue #1732.
 */

import {
  ArrowLeft,
  Brain,
  Calendar,
  CheckCircle,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Lightbulb,
  Link2,
  MapPin,
  Paperclip,
  Pencil,
  Sparkles,
  Tag,
  Trash2,
  User,
} from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState, Skeleton, SkeletonText } from '@/ui/components/feedback';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Separator } from '@/ui/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import {
  useMemoryAttachments,
  useMemoryContacts,
  useMemoryDetail,
  useRelatedMemories,
  useSimilarMemories,
} from '@/ui/hooks/queries/use-memories';
import type { Memory, MemoryAttachment } from '@/ui/lib/api-types';

/** Get icon for a memory type. */
function getTypeIcon(type: string | undefined): React.ReactNode {
  switch (type) {
    case 'preference':
      return <Lightbulb className="size-4" />;
    case 'fact':
      return <FileText className="size-4" />;
    case 'decision':
      return <CheckCircle className="size-4" />;
    case 'context':
      return <Layers className="size-4" />;
    default:
      return <Brain className="size-4" />;
  }
}

/** Get display label for a memory type. */
function getTypeLabel(type: string | undefined): string {
  switch (type) {
    case 'preference':
      return 'Preference';
    case 'fact':
      return 'Fact';
    case 'decision':
      return 'Decision';
    case 'context':
      return 'Context';
    case 'note':
      return 'Note';
    case 'reference':
      return 'Reference';
    default:
      return 'Memory';
  }
}

/** Get badge variant color for a memory type. */
function getTypeBadgeClass(type: string | undefined): string {
  switch (type) {
    case 'preference':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20';
    case 'fact':
      return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20';
    case 'decision':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20';
    case 'context':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20';
    default:
      return '';
  }
}

/** Format a date string for display. */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format file size for display. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MemoryDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: memory, isLoading, isError, error, refetch } = useMemoryDetail(id ?? '');
  const { data: attachmentsData } = useMemoryAttachments(id ?? '');
  const { data: contactsData } = useMemoryContacts(id ?? '');
  const { data: relatedData } = useRelatedMemories(id ?? '');
  const { data: similarData } = useSimilarMemories(id ?? '');

  const handleBack = useCallback(() => {
    navigate('/memory');
  }, [navigate]);

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="page-memory-detail" className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <Skeleton width={36} height={36} variant="circular" />
          <div className="flex-1">
            <Skeleton width={300} height={24} />
            <Skeleton width={200} height={16} className="mt-2" />
          </div>
        </div>
        <SkeletonText lines={5} />
      </div>
    );
  }

  // Error state
  if (isError || !memory) {
    return (
      <div data-testid="page-memory-detail" className="p-6">
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
          <ArrowLeft className="mr-2 size-4" />
          Back to Memories
        </Button>
        <ErrorState
          type={isError ? 'generic' : 'not-found'}
          title={isError ? 'Failed to load memory' : 'Memory not found'}
          description={isError && error instanceof Error ? error.message : 'The memory you are looking for does not exist or has been removed.'}
          onRetry={isError ? () => refetch() : undefined}
        />
      </div>
    );
  }

  const effectiveType = memory.memory_type ?? memory.type;
  const attachments: MemoryAttachment[] = Array.isArray(attachmentsData?.attachments) ? attachmentsData.attachments : [];
  const contacts = Array.isArray(contactsData?.contacts) ? contactsData.contacts : [];
  const related = Array.isArray(relatedData?.related) ? relatedData.related : [];
  const similar = Array.isArray(similarData?.similar) ? similarData.similar : [];

  return (
    <div data-testid="page-memory-detail" className="p-6 h-full flex flex-col">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4 w-fit" data-testid="back-button">
        <ArrowLeft className="mr-2 size-4" />
        Back to Memories
      </Button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {effectiveType && (
            <Badge variant="outline" className={`gap-1 ${getTypeBadgeClass(effectiveType)}`}>
              {getTypeIcon(effectiveType)}
              {getTypeLabel(effectiveType)}
            </Badge>
          )}
          {memory.is_active === false && (
            <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground">
              <EyeOff className="size-3" />
              Superseded
            </Badge>
          )}
          {memory.is_active !== false && (
            <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">
              <Eye className="size-3" />
              Active
            </Badge>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{memory.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Created {formatDate(memory.created_at)} &middot; Updated {formatDate(memory.updated_at)}
        </p>
      </div>

      {/* Tags */}
      {Array.isArray(memory.tags) && memory.tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              <Tag className="size-2.5" />
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <Separator className="mb-6" />

      {/* Tabbed content */}
      <Tabs defaultValue="content" className="flex-1">
        <TabsList data-testid="memory-detail-tabs">
          <TabsTrigger value="content" className="gap-1">
            <FileText className="size-3" />
            Content
          </TabsTrigger>
          <TabsTrigger value="metadata" className="gap-1">
            <Brain className="size-3" />
            Metadata
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-1">
            <User className="size-3" />
            Contacts ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="related" className="gap-1">
            <Link2 className="size-3" />
            Related ({related.length + similar.length})
          </TabsTrigger>
          <TabsTrigger value="attachments" className="gap-1">
            <Paperclip className="size-3" />
            Attachments ({attachments.length})
          </TabsTrigger>
        </TabsList>

        {/* Content Tab */}
        <TabsContent value="content" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <div className="prose dark:prose-invert max-w-none text-sm whitespace-pre-wrap" data-testid="memory-content">
                {memory.content}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Metadata Tab (#1719) */}
        <TabsContent value="metadata" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Importance</p>
                <p className="text-lg font-semibold">{memory.importance ?? '-'}/10</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                <p className="text-lg font-semibold">{memory.confidence != null ? `${(memory.confidence * 100).toFixed(0)}%` : '-'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Embedding Status</p>
                <p className="text-lg font-semibold capitalize">{memory.embedding_status ?? '-'}</p>
              </CardContent>
            </Card>
            {memory.expires_at && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Expires</p>
                  <p className="text-sm font-medium">{formatDate(memory.expires_at)}</p>
                </CardContent>
              </Card>
            )}
            {memory.source_url && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Source</p>
                  <a
                    href={memory.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="size-3" />
                    {memory.source_url}
                  </a>
                </CardContent>
              </Card>
            )}
            {memory.created_by_agent && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Created By</p>
                  <p className="text-sm font-medium">Agent: {memory.created_by_agent}</p>
                </CardContent>
              </Card>
            )}
            {memory.created_by_human && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Created By</p>
                  <p className="text-sm font-medium">Human</p>
                </CardContent>
              </Card>
            )}
            {memory.superseded_by && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Superseded By</p>
                  <button
                    className="text-sm text-primary hover:underline"
                    onClick={() => navigate(`/memory/${memory.superseded_by}`)}
                  >
                    View newer version
                  </button>
                </CardContent>
              </Card>
            )}
            {/* Geolocation (#1728) */}
            {(memory.place_label || memory.address) && (
              <Card className="sm:col-span-2">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <MapPin className="size-3" />
                    Location
                  </p>
                  {memory.place_label && <p className="text-sm font-medium">{memory.place_label}</p>}
                  {memory.address && <p className="text-sm text-muted-foreground">{memory.address}</p>}
                  {memory.lat != null && memory.lng != null && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${memory.lat}&mlon=${memory.lng}#map=16/${memory.lat}/${memory.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
                    >
                      <MapPin className="size-3" />
                      Open in Map ({memory.lat.toFixed(4)}, {memory.lng.toFixed(4)})
                    </a>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Contacts Tab (#1723) */}
        <TabsContent value="contacts" className="mt-4" data-testid="memory-contacts-tab">
          {contacts.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contacts.map((c) => (
                <Card key={c.contact_id}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      <User className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.display_name ?? 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">Linked {formatDate(c.linked_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/contacts/${c.contact_id}`)}
                    >
                      View
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              variant="contacts"
              title="No linked contacts"
              description="This memory is not linked to any contacts."
            />
          )}
        </TabsContent>

        {/* Related Memories Tab (#1724) */}
        <TabsContent value="related" className="mt-4" data-testid="memory-related-tab">
          {related.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium mb-2">Related Memories</h3>
              <div className="space-y-2">
                {related.map((r) => (
                  <Card key={r.relationship_id} className="cursor-pointer hover:bg-accent/30" onClick={() => navigate(`/memory/${r.id}`)}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">{getTypeLabel(r.type)}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{r.relationship_type}</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Sparkles className="size-3" />
                Similar Memories
              </h3>
              <div className="space-y-2">
                {similar.map((s) => (
                  <Card key={s.id} className="cursor-pointer hover:bg-accent/30" onClick={() => navigate(`/memory/${s.id}`)}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{getTypeLabel(s.memory_type ?? s.type ?? 'note')}</p>
                      </div>
                      <Badge variant="outline" className="text-xs gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">
                        <Sparkles className="size-2.5" />
                        {(s.similarity * 100).toFixed(0)}%
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {related.length === 0 && similar.length === 0 && (
            <EmptyState
              variant="documents"
              title="No related memories"
              description="No related or similar memories found."
            />
          )}
        </TabsContent>

        {/* Attachments Tab (#1726) */}
        <TabsContent value="attachments" className="mt-4" data-testid="memory-attachments-tab">
          {attachments.length > 0 ? (
            <div className="space-y-2">
              {attachments.map((att) => (
                <Card key={att.id}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Paperclip className="size-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{att.original_filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {att.content_type} &middot; {formatFileSize(att.size_bytes)} &middot; {formatDate(att.attached_at)}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <Download className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              variant="documents"
              title="No attachments"
              description="This memory has no file attachments."
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
