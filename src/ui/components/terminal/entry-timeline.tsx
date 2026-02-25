/**
 * Session entry timeline (Epic #1667, #1695).
 *
 * Vertical timeline of session entries, color-coded by kind.
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Terminal as TerminalIcon, FileText, MessageSquare, AlertCircle, Monitor } from 'lucide-react';
import type { TerminalSessionEntry } from '@/ui/lib/api-types';

interface EntryTimelineProps {
  entries: TerminalSessionEntry[];
}

const kindConfig: Record<string, { icon: React.ReactNode; colorClass: string; label: string }> = {
  command: { icon: <TerminalIcon className="size-3" />, colorClass: 'border-blue-500 bg-blue-500/10', label: 'Command' },
  output: { icon: <Monitor className="size-3" />, colorClass: 'border-gray-400 bg-gray-400/10', label: 'Output' },
  scrollback: { icon: <FileText className="size-3" />, colorClass: 'border-gray-300 bg-gray-300/10', label: 'Scrollback' },
  annotation: { icon: <MessageSquare className="size-3" />, colorClass: 'border-yellow-500 bg-yellow-500/10', label: 'Annotation' },
  error: { icon: <AlertCircle className="size-3" />, colorClass: 'border-red-500 bg-red-500/10', label: 'Error' },
};

export function EntryTimeline({ entries }: EntryTimelineProps): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="py-8 text-center" data-testid="entry-timeline-empty">
        <TerminalIcon className="mx-auto size-10 text-muted-foreground/30" />
        <p className="mt-3 text-sm text-muted-foreground">No entries recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0" data-testid="entry-timeline">
      {entries.map((entry) => {
        const config = kindConfig[entry.kind] ?? kindConfig.output;

        return (
          <div key={entry.id} className="flex gap-3 group" data-testid="entry-timeline-item">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center">
              <div className={`size-6 rounded-full border-2 flex items-center justify-center shrink-0 ${config.colorClass}`}>
                {config.icon}
              </div>
              <div className="w-px flex-1 bg-border" />
            </div>

            {/* Content */}
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px]">{config.label}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(entry.captured_at).toLocaleTimeString()}
                </span>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground/80 bg-muted/30 rounded p-2 max-h-48 overflow-y-auto">
                {entry.content}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
