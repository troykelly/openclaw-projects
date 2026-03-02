/**
 * Editor view for a dev prompt with Edit/Preview tabs.
 * Issue #2016.
 */
import { useState } from 'react';
import { ArrowLeft, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Textarea } from '@/ui/components/ui/textarea';
import { PromptPreview } from './prompt-preview';
import { VariableReference } from './variable-reference';
import { useUpdateDevPrompt, useResetDevPrompt, useRenderDevPrompt } from '@/ui/hooks/queries/use-dev-prompts';
import type { DevPrompt } from '@/ui/lib/api-types';

export interface PromptEditorProps {
  prompt: DevPrompt;
  onClose?: () => void;
}

export function PromptEditor({ prompt, onClose }: PromptEditorProps) {
  const [body, setBody] = useState(prompt.body);
  const [activeTab, setActiveTab] = useState('edit');

  const updateMutation = useUpdateDevPrompt();
  const resetMutation = useResetDevPrompt();
  const renderMutation = useRenderDevPrompt();

  function handleSave() {
    updateMutation.mutate({ id: prompt.id, body: { body } });
  }

  function handleReset() {
    resetMutation.mutate(prompt.id, {
      onSuccess: (result) => {
        setBody(result.body);
      },
    });
  }

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    if (tab === 'preview') {
      renderMutation.mutate({ id: prompt.id, variables: {} });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4 mb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="editor-close-button"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{prompt.title}</h2>
              <Badge variant="outline">{prompt.category}</Badge>
              {prompt.is_system && <Badge variant="secondary">system</Badge>}
            </div>
            <p className="text-xs text-muted-foreground font-mono">{prompt.prompt_key}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {prompt.is_system && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={resetMutation.isPending}
              data-testid="reset-prompt-button"
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              Reset to Default
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="save-prompt-button"
          >
            <Save className="mr-2 h-3 w-3" />
            Save
          </Button>
        </div>
      </div>

      {/* Mutation error feedback */}
      {updateMutation.error && (
        <p className="text-sm text-destructive mb-2">
          Save failed: {updateMutation.error.message}
        </p>
      )}
      {resetMutation.error && (
        <p className="text-sm text-destructive mb-2">
          Reset failed: {resetMutation.error.message}
        </p>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="flex-1 flex flex-col gap-4 mt-4">
          <Textarea
            data-testid="prompt-body-editor"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 min-h-[300px] font-mono text-sm resize-none"
            placeholder="Enter prompt template body..."
          />
          <VariableReference
            variables={renderMutation.data?.available_variables ?? []}
            defaultCollapsed
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <PromptPreview
            rendered={renderMutation.data?.rendered ?? ''}
            variablesUsed={renderMutation.data?.variables_used ?? []}
            isLoading={renderMutation.isPending}
            error={renderMutation.error?.message}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
