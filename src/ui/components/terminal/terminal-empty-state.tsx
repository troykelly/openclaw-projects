/**
 * Empty state for first-time terminal users (Epic #1667, #1691).
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Terminal, Server, Key } from 'lucide-react';

export function TerminalEmptyState(): React.JSX.Element {
  return (
    <Card data-testid="terminal-empty-state">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <Terminal className="size-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Get started with Terminal</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          Manage SSH connections and terminal sessions. Start by adding a credential and creating your first connection.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link to="/terminal/credentials">
              <Key className="mr-2 size-4" />
              Add Credential
            </Link>
          </Button>
          <Button asChild>
            <Link to="/terminal/connections">
              <Server className="mr-2 size-4" />
              Add Connection
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
