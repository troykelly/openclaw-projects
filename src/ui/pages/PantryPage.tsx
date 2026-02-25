/**
 * Pantry management page.
 *
 * Displays pantry inventory with filtering by category and location.
 * Items approaching their use-by date are highlighted. Supports
 * add, edit, deplete, and delete operations.
 *
 * @see Issue #1753
 */
import React, { useState, useCallback } from 'react';
import { Warehouse, Plus, Trash2, PackageMinus, Pencil, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { Textarea } from '@/ui/components/ui/textarea';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PantryItem {
  id: string;
  name: string;
  location: string;
  quantity: string | null;
  category: string | null;
  is_leftover: boolean;
  leftover_dish: string | null;
  leftover_portions: number | null;
  meal_log_id: string | null;
  added_date: string | null;
  use_by_date: string | null;
  use_soon: boolean;
  notes: string | null;
  is_depleted: boolean;
  depleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PantryListResponse {
  data: PantryItem[];
  total: number;
  limit: number;
  offset: number;
}

interface PantryFormData {
  name: string;
  location: string;
  quantity: string;
  category: string;
  use_by_date: string;
  use_soon: boolean;
  notes: string;
}

const EMPTY_FORM: PantryFormData = {
  name: '',
  location: '',
  quantity: '',
  category: '',
  use_by_date: '',
  use_soon: false,
  notes: '',
};

const CATEGORIES = [
  'dairy', 'produce', 'meat', 'seafood', 'bakery', 'pantry',
  'frozen', 'beverages', 'snacks', 'condiments', 'other',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the item's use_by_date is within the next 3 days. */
function isExpiringSoon(item: PantryItem): boolean {
  if (item.use_soon) return true;
  if (!item.use_by_date) return false;
  const expiryDate = new Date(item.use_by_date);
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  return expiryDate <= threeDaysFromNow && expiryDate >= new Date();
}

/** Returns true if the item is past its use-by date. */
function isExpired(item: PantryItem): boolean {
  if (!item.use_by_date) return false;
  return new Date(item.use_by_date) < new Date();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PantryPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [formData, setFormData] = useState<PantryFormData>(EMPTY_FORM);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Fetch pantry items
  const pantryQuery = useQuery({
    queryKey: ['pantry', categoryFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      const qs = params.toString();
      return apiClient.get<PantryListResponse>(`/api/pantry${qs ? `?${qs}` : ''}`);
    },
  });

  // Create item
  const createMutation = useMutation({
    mutationFn: (data: PantryFormData) => apiClient.post<PantryItem>('/api/pantry', data),
    onSuccess: () => {
      setCreateOpen(false);
      setFormData(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });

  // Update item
  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: PantryFormData & { id: string }) =>
      apiClient.patch<PantryItem>(`/api/pantry/${id}`, data),
    onSuccess: () => {
      setEditingItem(null);
      setFormData(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });

  // Deplete item
  const depleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/pantry/${id}/deplete`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });

  // Delete item
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/pantry/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });

  const handleCreate = useCallback(() => {
    createMutation.mutate(formData);
  }, [formData, createMutation]);

  const handleEdit = useCallback((item: PantryItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      location: item.location,
      quantity: item.quantity ?? '',
      category: item.category ?? '',
      use_by_date: item.use_by_date ?? '',
      use_soon: item.use_soon,
      notes: item.notes ?? '',
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingItem) return;
    updateMutation.mutate({ id: editingItem.id, ...formData });
  }, [editingItem, formData, updateMutation]);

  const handleOpenCreate = useCallback(() => {
    setFormData(EMPTY_FORM);
    setCreateOpen(true);
  }, []);

  const updateField = useCallback(
    <K extends keyof PantryFormData>(key: K, value: PantryFormData[K]) => {
      setFormData((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const items = Array.isArray(pantryQuery.data?.data) ? pantryQuery.data.data : [];
  const activeItems = items.filter((i) => !i.is_depleted);

  return (
    <div data-testid="page-pantry" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Warehouse className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Pantry</h1>
            <p className="text-sm text-muted-foreground">Track your pantry inventory</p>
          </div>
        </div>
        <Button onClick={handleOpenCreate} data-testid="add-pantry-item-button">
          <Plus className="mr-2 size-4" />
          Add Item
        </Button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">Category:</Label>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Item list */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-lg">
            Items{activeItems.length > 0 && ` (${activeItems.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pantryQuery.isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!pantryQuery.isLoading && activeItems.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Your pantry is empty.
            </p>
          )}
          <div className="space-y-2">
            {activeItems.map((item) => {
              const expiringSoon = isExpiringSoon(item);
              const expired = isExpired(item);

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                    expired
                      ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
                      : expiringSoon
                        ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
                        : 'border-border'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.quantity && (
                        <span className="text-sm text-muted-foreground">({item.quantity})</span>
                      )}
                      {item.category && (
                        <Badge variant="outline">{item.category}</Badge>
                      )}
                      {item.is_leftover && (
                        <Badge variant="secondary">leftover</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{item.location}</span>
                      {item.use_by_date && (
                        <span className="flex items-center gap-1">
                          {(expiringSoon || expired) && (
                            <AlertTriangle
                              className="size-3"
                              data-testid={`expiry-warning-${item.id}`}
                            />
                          )}
                          Use by: {new Date(item.use_by_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit"
                      onClick={() => handleEdit(item)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Mark as depleted"
                      onClick={() => depleteMutation.mutate(item.id)}
                      disabled={depleteMutation.isPending}
                    >
                      <PackageMinus className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md" data-testid="pantry-create-dialog">
          <DialogHeader>
            <DialogTitle>Add Pantry Item</DialogTitle>
            <DialogDescription>Add a new item to your pantry.</DialogDescription>
          </DialogHeader>
          <PantryForm formData={formData} updateField={updateField} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !formData.name.trim() || !formData.location.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editingItem !== null} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-md" data-testid="pantry-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit Pantry Item</DialogTitle>
            <DialogDescription>Update this pantry item.</DialogDescription>
          </DialogHeader>
          <PantryForm formData={formData} updateField={updateField} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || !formData.name.trim() || !formData.location.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PantryForm sub-component
// ---------------------------------------------------------------------------

interface PantryFormProps {
  formData: PantryFormData;
  updateField: <K extends keyof PantryFormData>(key: K, value: PantryFormData[K]) => void;
}

function PantryForm({ formData, updateField }: PantryFormProps): React.JSX.Element {
  return (
    <div className="space-y-3 py-2">
      <div>
        <Label htmlFor="pantry-name">Name *</Label>
        <Input
          id="pantry-name"
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="e.g. Organic Milk"
        />
      </div>
      <div>
        <Label htmlFor="pantry-location">Location *</Label>
        <Input
          id="pantry-location"
          value={formData.location}
          onChange={(e) => updateField('location', e.target.value)}
          placeholder="e.g. Fridge, Pantry shelf"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="pantry-quantity">Quantity</Label>
          <Input
            id="pantry-quantity"
            value={formData.quantity}
            onChange={(e) => updateField('quantity', e.target.value)}
            placeholder="e.g. 1L, 500g"
          />
        </div>
        <div>
          <Label htmlFor="pantry-category">Category</Label>
          <Select value={formData.category || 'none'} onValueChange={(v) => updateField('category', v === 'none' ? '' : v)}>
            <SelectTrigger id="pantry-category">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="pantry-use-by">Use by date</Label>
        <Input
          id="pantry-use-by"
          type="date"
          value={formData.use_by_date}
          onChange={(e) => updateField('use_by_date', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="pantry-notes">Notes</Label>
        <Textarea
          id="pantry-notes"
          value={formData.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          rows={2}
        />
      </div>
    </div>
  );
}
