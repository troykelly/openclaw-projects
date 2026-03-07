/**
 * Symphony Tool Config Page.
 *
 * Lists coding agent tool profiles with CRUD operations, auth
 * credential linking, feature flags, and task type configuration.
 *
 * @see Issue #2210 (Epic #2186)
 */
import React, { useState } from 'react';
import {
  Wrench,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
  Key,
  Settings2,
  Star,
} from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog';
import {
  useSymphonyTools,
  useCreateSymphonyTool,
  useDeleteSymphonyTool,
} from '@/ui/hooks/queries/use-symphony-hosts';
import type { SymphonyToolConfig, CreateSymphonyToolBody } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Tool Card
// ---------------------------------------------------------------------------

function ToolCard({
  tool,
  onDelete,
}: {
  tool: SymphonyToolConfig;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  return (
    <Card data-testid={`tool-card-${tool.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="size-5 text-primary" />
            <CardTitle className="text-lg">{tool.tool_name}</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            data-testid="delete-tool-button"
            onClick={() => onDelete(tool.id)}
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Command */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Command</p>
          <code className="text-xs font-mono bg-muted px-2 py-1 rounded-sm block truncate">
            {tool.command}
          </code>
        </div>

        {/* Verify + Version */}
        <div className="grid grid-cols-2 gap-3">
          {tool.verify_command && (
            <div>
              <p className="text-xs text-muted-foreground">Verify</p>
              <code className="text-xs font-mono">{tool.verify_command}</code>
            </div>
          )}
          {tool.min_version && (
            <div>
              <p className="text-xs text-muted-foreground">Min Version</p>
              <p className="text-sm">{tool.min_version}</p>
            </div>
          )}
        </div>

        {/* Timeout */}
        <div>
          <p className="text-xs text-muted-foreground">Timeout</p>
          <p className="text-sm">{tool.timeout_seconds}s</p>
        </div>

        {/* Auth Credential */}
        <div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Key className="size-3" />
            Auth Credential
          </p>
          {tool.auth_credential_name ? (
            <p data-testid="tool-auth-credential" className="text-sm">
              {tool.auth_credential_name}
            </p>
          ) : (
            <div
              data-testid="tool-no-auth-warning"
              className="flex items-center gap-1 text-xs text-yellow-500"
            >
              <AlertTriangle className="size-3" />
              No credential linked — will fail at provisioning
            </div>
          )}
        </div>

        {/* Feature Flags */}
        <div data-testid="tool-feature-flags">
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <Settings2 className="size-3" />
            Feature Flags
          </p>
          <div className="flex gap-2">
            <Badge variant={tool.supports_auto_approve ? 'default' : 'outline'} className="text-[10px]">
              auto_approve
            </Badge>
            <Badge variant={tool.supports_max_tokens ? 'default' : 'outline'} className="text-[10px]">
              max_tokens
            </Badge>
          </div>
        </div>

        {/* Task Types */}
        <div data-testid="tool-task-types">
          <p className="text-xs text-muted-foreground mb-1">Task Types</p>
          <div className="flex flex-wrap gap-1">
            {tool.task_types.length > 0 ? (
              tool.task_types.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">None assigned</span>
            )}
          </div>
        </div>

        {/* Default For */}
        {tool.is_default_for.length > 0 && (
          <div data-testid="tool-default-for">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
              <Star className="size-3" />
              Default For
            </p>
            <div className="flex flex-wrap gap-1">
              {tool.is_default_for.map((t) => (
                <Badge key={t} variant="default" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create Tool Dialog
// ---------------------------------------------------------------------------

function CreateToolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const createMutation = useCreateSymphonyTool();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [timeout, setTimeout] = useState('3600');

  const handleCreate = () => {
    const body: CreateSymphonyToolBody = {
      tool_name: name,
      command,
      timeout_seconds: parseInt(timeout, 10) || 3600,
    };
    createMutation.mutate(body, {
      onSuccess: () => {
        onOpenChange(false);
        setName('');
        setCommand('');
        setTimeout('3600');
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="tool-create-dialog">
        <DialogHeader>
          <DialogTitle>Create Tool Config</DialogTitle>
          <DialogDescription>
            Add a new coding agent tool configuration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="tool-name">Tool Name</Label>
            <Input
              id="tool-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., claude-code"
              data-testid="tool-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tool-command">Command</Label>
            <Input
              id="tool-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g., claude --dangerously-skip-permissions"
              data-testid="tool-command-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tool-timeout">Timeout (seconds)</Label>
            <Input
              id="tool-timeout"
              type="number"
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
              data-testid="tool-timeout-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name || !command || createMutation.isPending}
            data-testid="create-tool-submit"
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Plus className="mr-1 size-3" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ToolConfigPage(): React.JSX.Element {
  const { data, isLoading, error } = useSymphonyTools();
  const deleteMutation = useDeleteSymphonyTool();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div data-testid="page-symphony-tools" className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-symphony-tools" className="p-6">
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Error loading tools: {(error as Error).message}
          </CardContent>
        </Card>
      </div>
    );
  }

  const tools = Array.isArray(data?.tools) ? data.tools : [];

  return (
    <div data-testid="page-symphony-tools" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tool Configs</h1>
            <p className="text-sm text-muted-foreground">
              Manage coding agent tool configurations
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="create-tool-button">
          <Plus className="mr-2 size-4" />
          New Tool
        </Button>
      </div>

      {/* Validation: check that at least one tool is default for implementation */}
      {tools.length > 0 && !tools.some((t) => t.is_default_for.includes('implementation')) && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-sm bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle className="size-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-500">
            No tool is set as default for &quot;implementation&quot;. Symphony cannot start runs until one is configured.
          </p>
        </div>
      )}

      {/* Tool Grid */}
      {tools.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No tool configs. Create one to get started with Symphony.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onDelete={(id) => setDeleteId(id)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <CreateToolDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool Config?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the tool configuration.
              Running sessions using this tool will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  deleteMutation.mutate(deleteId);
                  setDeleteId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
