/**
 * Collapsible panel listing all available template variables.
 * Issue #2016.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DevPromptVariableDefinition } from '@/ui/lib/api-types';

export interface VariableReferenceProps {
  variables: DevPromptVariableDefinition[];
  defaultCollapsed?: boolean;
}

export function VariableReference({ variables, defaultCollapsed = false }: VariableReferenceProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="rounded-md border">
      <button
        data-testid="variable-reference-toggle"
        className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        Template Variables
      </button>

      {!collapsed && (
        <div className="border-t px-4 py-2">
          {variables.length === 0 ? (
            <p className="text-xs text-muted-foreground">No variables available.</p>
          ) : (
            <div className="space-y-2">
              {variables.map((v) => (
                <div key={v.name} className="flex items-start gap-3 text-xs">
                  <code className="font-mono text-primary whitespace-nowrap">{v.name}</code>
                  <span className="text-muted-foreground flex-1">{v.description}</span>
                  <span className="text-muted-foreground/70 font-mono whitespace-nowrap">
                    {v.example}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
