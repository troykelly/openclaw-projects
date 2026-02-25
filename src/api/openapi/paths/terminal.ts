/**
 * OpenAPI path definitions for all terminal management endpoints.
 * Epic #1667 — TMux Session Management.
 *
 * This module aggregates all terminal sub-modules into a single domain module
 * for backward compatibility with the index.ts registration.
 *
 * Sub-modules:
 * - terminal-connections.ts — Connection CRUD, test, SSH config import
 * - terminal-credentials.ts — Credential CRUD, key pair generation
 * - terminal-sessions.ts — Session lifecycle, windows, panes, WebSocket attach
 * - terminal-commands.ts — send-command, send-keys, capture
 * - terminal-entries.ts — Entry listing, export
 * - terminal-search.ts — Semantic search
 * - terminal-tunnels.ts — SSH tunnel CRUD
 * - terminal-enrollment.ts — Enrollment tokens, self-registration
 * - terminal-known-hosts.ts — Known host CRUD, approval
 * - terminal-activity.ts — Audit trail
 * - terminal-settings.ts — Retention settings, worker status
 */
import type { OpenApiDomainModule, PathItemObject, SchemaObject } from '../types.ts';
import { terminalConnectionsPaths } from './terminal-connections.ts';
import { terminalCredentialsPaths } from './terminal-credentials.ts';
import { terminalSessionsPaths } from './terminal-sessions.ts';
import { terminalCommandsPaths } from './terminal-commands.ts';
import { terminalEntriesPaths } from './terminal-entries.ts';
import { terminalSearchPaths } from './terminal-search.ts';
import { terminalTunnelsPaths } from './terminal-tunnels.ts';
import { terminalEnrollmentPaths } from './terminal-enrollment.ts';
import { terminalKnownHostsPaths } from './terminal-known-hosts.ts';
import { terminalActivityPaths } from './terminal-activity.ts';
import { terminalSettingsPaths } from './terminal-settings.ts';

export function terminalPaths(): OpenApiDomainModule {
  const subModules: OpenApiDomainModule[] = [
    terminalConnectionsPaths(),
    terminalCredentialsPaths(),
    terminalSessionsPaths(),
    terminalCommandsPaths(),
    terminalEntriesPaths(),
    terminalSearchPaths(),
    terminalTunnelsPaths(),
    terminalEnrollmentPaths(),
    terminalKnownHostsPaths(),
    terminalActivityPaths(),
    terminalSettingsPaths(),
  ];

  const paths: Record<string, PathItemObject> = {};
  const schemas: Record<string, SchemaObject> = {};
  const tags: Array<{ name: string; description: string }> = [];

  for (const mod of subModules) {
    for (const [path, item] of Object.entries(mod.paths)) {
      if (paths[path]) {
        Object.assign(paths[path], item);
      } else {
        paths[path] = { ...item };
      }
    }

    if (mod.schemas) {
      Object.assign(schemas, mod.schemas);
    }

    if (mod.tags) {
      for (const tag of mod.tags) {
        if (!tags.some((t) => t.name === tag.name)) {
          tags.push(tag);
        }
      }
    }
  }

  return { paths, schemas, tags };
}
