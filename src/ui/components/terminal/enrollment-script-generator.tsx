/**
 * Enrollment script generator (Epic #1667, #1696).
 *
 * Displays a copyable enrollment script after token creation.
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Check, Copy } from 'lucide-react';
import type { TerminalEnrollmentToken } from '@/ui/lib/api-types';

interface EnrollmentScriptGeneratorProps {
  token: TerminalEnrollmentToken;
  apiBaseUrl: string;
}

export function EnrollmentScriptGenerator({ token, apiBaseUrl }: EnrollmentScriptGeneratorProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  if (!token.token) return null;

  const script = `#!/bin/bash
# Enrollment script for: ${token.label}
# Token expires: ${token.expires_at ? new Date(token.expires_at).toLocaleString() : 'Never'}
# Max uses: ${token.max_uses ?? 'Unlimited'}

curl -X POST ${apiBaseUrl}/api/terminal/enroll \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "${token.token}",
    "hostname": "$(hostname)",
    "ssh_port": 22,
    "public_key": "$(cat ~/.ssh/id_ed25519.pub 2>/dev/null || echo 'NO_KEY')"
  }'`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card data-testid="enrollment-script">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Enrollment Script</CardTitle>
        <Button size="sm" variant="outline" className="h-7" onClick={() => void handleCopy()}>
          {copied ? <Check className="mr-1 size-3" /> : <Copy className="mr-1 size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="text-xs font-mono bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap">
          {script}
        </pre>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          This token is shown only once. Save it now.
        </p>
      </CardContent>
    </Card>
  );
}
