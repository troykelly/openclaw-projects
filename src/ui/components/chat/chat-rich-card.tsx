/**
 * Rich content card for agent chat (Epic #1940, Issue #1952).
 *
 * Renders structured card content sent by agents, including
 * confirmation dialogs, task summaries, multiple choice, and info cards.
 * Action buttons send signed responses back to the agent.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RichCardAction {
  id: string;
  label: string;
  style: 'primary' | 'destructive' | 'default';
  payload: string;
}

export interface RichCardData {
  type: 'confirmation' | 'task_summary' | 'choice' | 'info';
  title: string;
  body: string;
  actions?: RichCardAction[];
  metadata?: Record<string, unknown>;
}

interface ChatRichCardProps {
  data: RichCardData;
  sessionId: string;
  messageId: string;
}

type ActionState = 'idle' | 'loading' | 'completed' | 'error';

// ---------------------------------------------------------------------------
// Card type icons (simple text-based)
// ---------------------------------------------------------------------------

const CARD_ICONS: Record<string, string> = {
  confirmation: '\u2753', // question mark
  task_summary: '\u{1F4CB}', // clipboard (but we avoid emojis in code output, this is data)
  choice: '\u2630', // trigram
  info: '\u2139', // info
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatRichCard({ data, sessionId, messageId }: ChatRichCardProps): React.JSX.Element {
  const [actionStates, setActionStates] = React.useState<Record<string, ActionState>>({});

  const handleAction = React.useCallback(async (action: RichCardAction) => {
    // Prevent double-click
    if (actionStates[action.id] === 'loading' || actionStates[action.id] === 'completed') {
      return;
    }

    setActionStates((prev) => ({ ...prev, [action.id]: 'loading' }));

    try {
      await apiClient.post(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          content: JSON.stringify({
            action_id: action.id,
            card_message_id: messageId,
            payload: action.payload,
          }),
          content_type: 'application/vnd.openclaw.action-response',
          idempotency_key: crypto.randomUUID(),
        },
      );

      setActionStates((prev) => ({ ...prev, [action.id]: 'completed' }));
    } catch {
      setActionStates((prev) => ({ ...prev, [action.id]: 'error' }));

      // Reset to idle after brief delay so user can retry
      setTimeout(() => {
        setActionStates((prev) => {
          if (prev[action.id] === 'error') {
            return { ...prev, [action.id]: 'idle' };
          }
          return prev;
        });
      }, 100);
    }
  }, [actionStates, sessionId, messageId]);

  const actions = Array.isArray(data.actions) ? data.actions : [];

  return (
    <div
      data-testid="rich-card"
      className={cn(
        'rounded-lg border bg-card p-3 text-card-foreground shadow-sm',
        'max-w-sm',
      )}
    >
      {/* Title */}
      {data.title && (
        <h4 className="mb-1 text-sm font-semibold">{data.title}</h4>
      )}

      {/* Body */}
      {data.body && (
        <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {data.body}
        </p>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const state = actionStates[action.id] ?? 'idle';

            return (
              <button
                key={action.id}
                type="button"
                data-testid={`action-btn-${action.id}`}
                disabled={state === 'loading' || state === 'completed'}
                onClick={() => { void handleAction(action); }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  action.style === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                  action.style === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                  action.style === 'default' && 'border bg-background hover:bg-accent hover:text-accent-foreground',
                  (state === 'loading' || state === 'completed') && 'opacity-60 cursor-not-allowed',
                )}
              >
                {state === 'loading' && (
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                )}
                {state === 'completed' && (
                  <span aria-hidden="true">{'\u2713'}</span>
                )}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Parse and validate rich card JSON content.
 * Returns null if the content is not valid rich card data.
 */
export function parseRichCardContent(content: string): RichCardData | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    if (typeof parsed.type !== 'string') return null;
    if (!['confirmation', 'task_summary', 'choice', 'info'].includes(parsed.type)) return null;

    return {
      type: parsed.type as RichCardData['type'],
      title: typeof parsed.title === 'string' ? parsed.title : '',
      body: typeof parsed.body === 'string' ? parsed.body : '',
      actions: Array.isArray(parsed.actions)
        ? (parsed.actions as Record<string, unknown>[])
            .filter((a) => typeof a.id === 'string' && typeof a.label === 'string')
            .map((a) => ({
              id: a.id as string,
              label: a.label as string,
              style: (['primary', 'destructive', 'default'].includes(a.style as string)
                ? a.style
                : 'default') as RichCardAction['style'],
              payload: typeof a.payload === 'string' ? a.payload : '',
            }))
        : [],
      metadata: typeof parsed.metadata === 'object' && parsed.metadata !== null
        ? parsed.metadata as Record<string, unknown>
        : undefined,
    };
  } catch {
    return null;
  }
}
