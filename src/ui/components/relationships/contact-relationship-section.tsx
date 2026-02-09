/**
 * Section for displaying contact relationships
 * Issue #395: Implement contact relationship types
 */
import * as React from 'react';
import { Plus, Users } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { RelationshipCard } from './relationship-card';
import { AddRelationshipDialog } from './add-relationship-dialog';
import type { ContactRelationship, Contact, NewRelationshipData, RelationshipCategory } from './types';
import { getRelationshipCategory, CATEGORY_LABELS } from './relationship-utils';

export interface ContactRelationshipSectionProps {
  contactId: string;
  relationships: ContactRelationship[];
  relatedContacts: Contact[];
  availableContacts: Contact[];
  onAddRelationship: (data: NewRelationshipData) => void;
  onEditRelationship: (relationshipId: string) => void;
  onRemoveRelationship: (relationshipId: string) => void;
  className?: string;
}

export function ContactRelationshipSection({
  contactId,
  relationships,
  relatedContacts,
  availableContacts,
  onAddRelationship,
  onEditRelationship,
  onRemoveRelationship,
  className,
}: ContactRelationshipSectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Group relationships by category
  const groupedRelationships = React.useMemo(() => {
    const groups: Record<RelationshipCategory, ContactRelationship[]> = {
      professional: [],
      business: [],
      personal: [],
    };

    for (const rel of relationships) {
      const category = getRelationshipCategory(rel.type);
      groups[category].push(rel);
    }

    return groups;
  }, [relationships]);

  // Map of related contact ID to contact
  const contactMap = React.useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of relatedContacts) {
      map.set(contact.id, contact);
    }
    return map;
  }, [relatedContacts]);

  const hasRelationships = relationships.length > 0;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Relationships</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{relationships.length}</span>
        </div>
        <Button variant="outline" size="sm" className="h-7" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Relationship
        </Button>
      </div>

      {/* Content */}
      {hasRelationships ? (
        <div className="space-y-4">
          {(Object.entries(groupedRelationships) as [RelationshipCategory, ContactRelationship[]][]).map(([category, rels]) => {
            if (rels.length === 0) return null;

            return (
              <div key={category}>
                <div className="text-xs font-medium text-muted-foreground mb-2">{CATEGORY_LABELS[category]}</div>
                <div className="space-y-2">
                  {rels.map((rel) => {
                    const contact = contactMap.get(rel.relatedContactId);
                    if (!contact) return null;

                    return <RelationshipCard key={rel.id} relationship={rel} contact={contact} onEdit={onEditRelationship} onRemove={onRemoveRelationship} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-8 text-center text-muted-foreground">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No relationships yet</p>
          <p className="text-xs mt-1">Add relationships to track connections</p>
        </div>
      )}

      {/* Add dialog */}
      <AddRelationshipDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentContactId={contactId}
        availableContacts={availableContacts}
        onAddRelationship={onAddRelationship}
      />
    </div>
  );
}
