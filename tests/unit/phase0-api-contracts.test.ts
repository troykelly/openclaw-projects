/**
 * @vitest-environment node
 *
 * Unit tests for Phase 0 API contract fixes (Epic #2130).
 *
 * Issue #2097: SSH config import field name (config → config_text)
 * Issue #2098: Search API response shape (results/entry → items flat)
 * Issue #2099: Key generation field name (key_type → type)
 * Issue #2122: Enrollment script unsubstituted $API_BASE_URL
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../src');

// ---------------------------------------------------------------------------
// #2097 — SSH config import must send `config_text`, not `config`
// ---------------------------------------------------------------------------
describe('#2097: SSH config import field name', () => {
  it('useImportSshConfig sends config_text field, not config', () => {
    const filePath = path.join(SRC_ROOT, 'ui/hooks/queries/use-terminal-connections.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Must send `config_text` to match backend expectation
    expect(content).toContain('config_text');
    // Must NOT send bare `config` as the field name (but can appear in function name etc.)
    // The specific pattern: `{ config }` or `{ config:` as object literal sent to API
    expect(content).not.toMatch(/apiClient\.post\S*\([^)]*\{\s*config\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// #2098 — Search API response shape must match backend `{ items }` not `{ results }`
// ---------------------------------------------------------------------------
describe('#2098: Search API response shape', () => {
  it('TerminalSearchResponse uses items field matching backend', () => {
    const filePath = path.join(SRC_ROOT, 'ui/lib/api-types.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // The response type should have `items`, not `results`
    expect(content).toMatch(/interface\s+TerminalSearchResponse\s*\{[^}]*items/s);
  });

  it('TerminalSearchPage reads items from response, not results', () => {
    const filePath = path.join(SRC_ROOT, 'ui/pages/terminal/TerminalSearchPage.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Should use `.items` not `.results`
    expect(content).toContain('.items');
    expect(content).not.toMatch(/\.data\?\.results/);
  });

  it('TerminalSearchItem has flat shape with similarity, not nested entry/score', () => {
    const filePath = path.join(SRC_ROOT, 'ui/lib/api-types.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Should have a TerminalSearchItem interface with similarity field
    expect(content).toMatch(/interface\s+TerminalSearchItem\s*\{[^}]*similarity/s);
  });

  it('SearchResultContext reads flat item fields, not nested entry', () => {
    const filePath = path.join(SRC_ROOT, 'ui/components/terminal/search-result-context.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Should not destructure `entry` from result (flat shape now)
    expect(content).not.toMatch(/const\s*\{\s*entry\s*,/);
  });
});

// ---------------------------------------------------------------------------
// #2099 — Key generation must send `type`, not `key_type`
// ---------------------------------------------------------------------------
describe('#2099: Key generation field name', () => {
  it('useGenerateTerminalKeyPair sends type field, not key_type', () => {
    const filePath = path.join(SRC_ROOT, 'ui/hooks/queries/use-terminal-credentials.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // The mutation function parameter should use `type`, not `key_type`
    // Check there's no `key_type` in the interface/parameter definition
    expect(content).not.toContain('key_type');
  });
});

// ---------------------------------------------------------------------------
// #2122 — Enrollment script must substitute real API base URL
// ---------------------------------------------------------------------------
describe('#2122: Enrollment script URL substitution', () => {
  it('enrollment script does not contain literal $API_BASE_URL placeholder', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Find the enrollment_script line(s)
    const enrollmentLines = content.split('\n').filter((line) =>
      line.includes('enrollment_script'),
    );

    // There should be enrollment_script references
    expect(enrollmentLines.length).toBeGreaterThan(0);

    // None should contain literal unsubstituted $API_BASE_URL
    for (const line of enrollmentLines) {
      expect(line).not.toContain('"$API_BASE_URL');
      expect(line).not.toContain("'$API_BASE_URL");
    }
  });

  it('enrollment script uses request-derived base URL', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Should derive the base URL from the request (protocol + host)
    // Look for pattern that constructs URL from req
    expect(content).toMatch(/req\.protocol|req\.hostname|req\.headers/);
  });
});
