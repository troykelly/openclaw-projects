/**
 * Enrollment Page (Epic #1667, #1696).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { Plus, Ticket, Trash2 } from 'lucide-react';
import { EnrollmentForm } from '@/ui/components/terminal/enrollment-form';
import { EnrollmentScriptGenerator } from '@/ui/components/terminal/enrollment-script-generator';
import {
  useTerminalEnrollmentTokens,
  useCreateTerminalEnrollmentToken,
  useDeleteTerminalEnrollmentToken,
} from '@/ui/hooks/queries/use-terminal-enrollment';
import { getApiBaseUrl } from '@/ui/lib/api-config';
import type { TerminalEnrollmentToken } from '@/ui/lib/api-types';

export function EnrollmentPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [newToken, setNewToken] = useState<TerminalEnrollmentToken | null>(null);

  const tokensQuery = useTerminalEnrollmentTokens();
  const createToken = useCreateTerminalEnrollmentToken();
  const deleteToken = useDeleteTerminalEnrollmentToken();

  const tokens = Array.isArray(tokensQuery.data?.tokens) ? tokensQuery.data.tokens : [];

  const handleCreate = (data: { label: string; max_uses?: number; expires_at?: string; allowed_tags?: string[] }) => {
    createToken.mutate(data, {
      onSuccess: (token) => {
        setCreateOpen(false);
        setNewToken(token);
      },
    });
  };

  return (
    <div data-testid="page-enrollment" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enrollment</h1>
          <p className="text-sm text-muted-foreground">Generate tokens for remote server self-registration</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" /> New Token
        </Button>
      </div>

      {newToken && <EnrollmentScriptGenerator token={newToken} apiBaseUrl={getApiBaseUrl()} />}

      {tokens.length === 0 ? (
        <div className="py-12 text-center">
          <Ticket className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No enrollment tokens yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.map((token) => (
            <Card key={token.id} data-testid="enrollment-token-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Ticket className="size-4 text-muted-foreground" />
                  {token.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uses</span>
                  <span>{token.uses}{token.max_uses ? ` / ${token.max_uses}` : ''}</span>
                </div>
                {token.expires_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span>{new Date(token.expires_at).toLocaleString()}</span>
                  </div>
                )}
                {token.allowed_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {token.allowed_tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex justify-end pt-1">
                  <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={() => deleteToken.mutate(token.id)}>
                    <Trash2 className="size-3 mr-1" /> Revoke
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EnrollmentForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isPending={createToken.isPending}
      />
    </div>
  );
}
