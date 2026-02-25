/**
 * Proxy/jump host chain visualization (Epic #1667, #1692).
 */
import * as React from 'react';
import { ArrowRight, Server } from 'lucide-react';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface ProxyChainDiagramProps {
  connection: TerminalConnection;
  allConnections: TerminalConnection[];
}

function buildChain(connection: TerminalConnection, allConnections: TerminalConnection[]): TerminalConnection[] {
  const chain: TerminalConnection[] = [connection];
  let current = connection;

  while (current.proxy_jump_id) {
    const jump = allConnections.find((c) => c.id === current.proxy_jump_id);
    if (!jump || chain.includes(jump)) break;
    chain.unshift(jump);
    current = jump;
  }

  return chain;
}

export function ProxyChainDiagram({ connection, allConnections }: ProxyChainDiagramProps): React.JSX.Element | null {
  const chain = buildChain(connection, allConnections);

  if (chain.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="proxy-chain">
      {chain.map((hop, i) => (
        <React.Fragment key={hop.id}>
          {i > 0 && <ArrowRight className="size-3 text-muted-foreground shrink-0" />}
          <div className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">
            <Server className="size-3 text-muted-foreground" />
            <span>{hop.name}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
