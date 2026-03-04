/**
 * Terminal toolbar (Epic #1667, #1694).
 *
 * Window tabs, split, annotate, fullscreen, search controls.
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Maximize2, Minimize2, SplitSquareVertical, Search, MessageSquare, RefreshCw } from 'lucide-react';
import type { TerminalSessionWindow } from '@/ui/lib/api-types';

interface TerminalToolbarProps {
  windows?: TerminalSessionWindow[];
  activeWindowId?: string;
  onWindowSelect?: (windowId: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onAnnotate?: () => void;
  onSearch?: () => void;
  onSplit?: () => void;
  onRefreshWindows?: () => void;
}

export function TerminalToolbar({
  windows,
  activeWindowId,
  onWindowSelect,
  isFullscreen,
  onToggleFullscreen,
  onAnnotate,
  onSearch,
  onSplit,
  onRefreshWindows,
}: TerminalToolbarProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-1" data-testid="terminal-toolbar">
      {/* Window tabs */}
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {windows?.map((win) => (
          <Button
            key={win.id}
            size="sm"
            variant={win.id === activeWindowId ? 'default' : 'ghost'}
            className="h-7 text-xs"
            onClick={() => onWindowSelect?.(win.id)}
          >
            {win.window_name ?? `Window ${win.window_index}`}
            {win.is_active && <Badge variant="secondary" className="ml-1 text-[10px] px-1">active</Badge>}
          </Button>
        ))}
      </div>

      {/* Actions (#2121: aria-labels for accessibility) */}
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onRefreshWindows} title="Refresh windows" aria-label="Refresh windows">
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSearch} title="Search (Ctrl+Shift+F)" aria-label="Search">
          <Search className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSplit} title="Split pane" aria-label="Split pane">
          <SplitSquareVertical className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onAnnotate} title="Add annotation" aria-label="Add annotation">
          <MessageSquare className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
