/**
 * Namespace management settings page (Issue #2353).
 *
 * Located at /app/settings/namespaces. Provides:
 * - Namespace list with access level, home badge, member count
 * - Namespace detail with member table
 * - Create namespace dialog with validation
 * - Invite member dialog
 * - Remove grant with confirmation
 */

import { AlertTriangle, ArrowLeft, Crown, Plus, Shield, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { useCreateNamespace, useInviteMember, useRemoveGrant, useUpdateGrant } from '@/ui/hooks/mutations/use-namespace-mutations';
import { useNamespaceDetail, useNamespaceList } from '@/ui/hooks/queries/use-namespaces';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_NAMESPACE_LENGTH = 63;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Create namespace dialog. */
function CreateNamespaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const createMutation = useCreateNamespace();

  const isValid = name.length > 0 && name.length <= MAX_NAMESPACE_LENGTH && NAMESPACE_NAME_PATTERN.test(name);
  const showError = name.length > 0 && !isValid;

  const handleCreate = useCallback(() => {
    if (!isValid) return;
    createMutation.mutate(
      { name },
      {
        onSuccess: () => {
          setName('');
          onOpenChange(false);
        },
      },
    );
  }, [name, isValid, createMutation, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Namespace</DialogTitle>
          <DialogDescription>Create a new namespace to organize your data.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="ns-name">Namespace Name</Label>
            <Input
              id="ns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-project"
              maxLength={MAX_NAMESPACE_LENGTH}
              aria-describedby={showError ? 'ns-name-error' : undefined}
            />
            {showError && (
              <p id="ns-name-error" className="mt-1 text-sm text-destructive">
                Must match pattern: lowercase letters, numbers, dots, hyphens, underscores. Must start with letter or number. Max {MAX_NAMESPACE_LENGTH}{' '}
                characters.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid || createMutation.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Invite member dialog. */
function InviteMemberDialog({ open, onOpenChange, namespace }: { open: boolean; onOpenChange: (open: boolean) => void; namespace: string }) {
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState('read');
  const inviteMutation = useInviteMember();

  const handleInvite = useCallback(() => {
    if (!email.trim()) return;
    inviteMutation.mutate(
      { ns: namespace, email: email.trim(), access },
      {
        onSuccess: () => {
          setEmail('');
          setAccess('read');
          onOpenChange(false);
        },
      },
    );
  }, [email, access, namespace, inviteMutation, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>
            Add a member to the <strong>{namespace}</strong> namespace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          <div>
            <Label htmlFor="invite-access">Access Level</Label>
            <Select value={access} onValueChange={setAccess}>
              <SelectTrigger id="invite-access">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="readwrite">Read & Write</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={!email.trim() || inviteMutation.isPending}>
            Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Remove grant confirmation dialog. */
function RemoveGrantDialog({
  open,
  onOpenChange,
  namespace,
  grantId,
  userEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  namespace: string;
  grantId: string;
  userEmail: string;
}) {
  const removeMutation = useRemoveGrant();

  const handleRemove = useCallback(() => {
    removeMutation.mutate(
      { ns: namespace, grantId },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  }, [namespace, grantId, removeMutation, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Remove Member
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to remove <strong>{userEmail}</strong> from the <strong>{namespace}</strong> namespace? They will lose all access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removeMutation.isPending}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Namespace list view. */
function NamespaceListView() {
  const { data, isLoading, isError } = useNamespaceList();
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div data-testid="namespace-settings-loading" className="flex items-center justify-center py-12">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-destructive">Error loading namespaces</p>
      </div>
    );
  }

  const namespaces = data?.data ?? [];

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Namespaces</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your namespace memberships and access.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} aria-label="Create Namespace">
          <Plus className="mr-2 size-4" />
          Create Namespace
        </Button>
      </div>

      {namespaces.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No namespaces found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {namespaces.map((ns) => (
            <Card
              key={ns.namespace}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => navigate(`/settings/namespaces/${encodeURIComponent(ns.namespace)}`)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="size-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{ns.namespace}</span>
                      {ns.is_home && (
                        <Badge variant="secondary" className="text-xs">
                          <Crown className="mr-1 size-3" />
                          Home
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {ns.member_count} {ns.member_count === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                </div>
                <Badge variant={ns.access === 'readwrite' ? 'default' : 'outline'}>
                  {ns.access === 'readwrite' ? (
                    <>
                      <ShieldCheck className="mr-1 size-3" />
                      {ns.access}
                    </>
                  ) : (
                    <>
                      <Shield className="mr-1 size-3" />
                      {ns.access}
                    </>
                  )}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateNamespaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

/** Namespace detail view with members table. */
function NamespaceDetailView({ ns }: { ns: string }) {
  const { data, isLoading, isError } = useNamespaceDetail(ns);
  const updateGrant = useUpdateGrant();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    grantId: string;
    userEmail: string;
  } | null>(null);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div data-testid="namespace-settings-loading" className="flex items-center justify-center py-12">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !data?.data) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-destructive">Error loading namespace details</p>
      </div>
    );
  }

  const detail = data.data;

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings/namespaces')} aria-label="Back" className="mb-4">
          <ArrowLeft className="mr-2 size-4" />
          Back to Namespaces
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{detail.namespace}</h1>
            <p className="text-sm text-muted-foreground mt-1">Created {new Date(detail.created_at).toLocaleDateString()}</p>
          </div>
          <Button onClick={() => setInviteOpen(true)} aria-label="Invite Member">
            <Plus className="mr-2 size-4" />
            Invite Member
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members ({detail.grants.length})</CardTitle>
          <CardDescription>Manage who has access to this namespace.</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.grants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No members.</p>
          ) : (
            <div className="divide-y">
              {detail.grants.map((grant) => (
                <div key={grant.id} data-testid={`grant-row-${grant.id}`} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                      {grant.user_email[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{grant.user_email}</span>
                        {grant.is_home && (
                          <Badge variant="secondary" className="text-xs">
                            Home
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Joined {new Date(grant.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={grant.access} onValueChange={(access) => updateGrant.mutate({ ns, grantId: grant.id, access })}>
                      <SelectTrigger className="w-[130px]" aria-label={`Access level for ${grant.user_email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">Read</SelectItem>
                        <SelectItem value="readwrite">Read & Write</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid="remove-grant-btn"
                      onClick={() =>
                        setRemoveTarget({
                          grantId: grant.id,
                          userEmail: grant.user_email,
                        })
                      }
                      aria-label={`Remove ${grant.user_email}`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} namespace={ns} />

      {removeTarget && (
        <RemoveGrantDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          namespace={ns}
          grantId={removeTarget.grantId}
          userEmail={removeTarget.userEmail}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function NamespaceSettingsPage(): React.JSX.Element {
  const { ns } = useParams<{ ns?: string }>();

  return (
    <div data-testid="page-namespace-settings" className="h-full p-6">
      <div className="mx-auto max-w-3xl">{ns ? <NamespaceDetailView ns={ns} /> : <NamespaceListView />}</div>
    </div>
  );
}
