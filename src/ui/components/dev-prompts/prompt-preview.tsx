/**
 * Preview panel showing rendered Handlebars output.
 * Issue #2016.
 */
import { Badge } from '@/ui/components/ui/badge';

export interface PromptPreviewProps {
  rendered: string;
  variablesUsed: string[];
  isLoading: boolean;
  error?: string;
}

export function PromptPreview({ rendered, variablesUsed, isLoading, error }: PromptPreviewProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Rendering preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive border border-destructive/20 rounded-md">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <pre
        data-testid="prompt-preview-output"
        className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm font-mono"
      >
        {rendered}
      </pre>

      {variablesUsed.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Variables used:</span>
          {variablesUsed.map((v) => (
            <Badge key={v} variant="outline" className="text-xs font-mono">
              {v}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
