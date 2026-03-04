/**
 * @vitest-environment node
 *
 * Unit tests for Phase 2 Security Hardening (Epic #2130).
 *
 * Issue #2103: SOCKS5 parser DoS via malformed short packets
 * Issue #2104: Enrollment token max_uses race condition (source-level verification)
 * Issue #2105: WebSocket auth token via query string (leak risk)
 * Issue #2106: gRPC mTLS silent fallback to insecure
 * Issue #2107: Known-host approve/reject writes DB before gRPC call
 * Issue #2108: openssh-server in runtime image
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../src');
const DOCKER_ROOT = path.resolve(__dirname, '../../docker');

// ---------------------------------------------------------------------------
// #2103 — SOCKS5 parser must validate packet length before reading offsets
// ---------------------------------------------------------------------------
describe('#2103: SOCKS5 parser DoS via malformed short packets', () => {
  it('validates greeting packet length before accessing fields', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/tunnel-handlers.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // The SOCKS5 greeting handler must check minimum length before accessing greeting[0]
    // Look for a length check near the SOCKS5 greeting handling
    expect(content).toMatch(/greeting\.length\s*[<>=]/);
  });

  it('validates request packet length for IPv4 address type', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/tunnel-handlers.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // For IPv4 (0x01): needs at least 10 bytes (4 header + 4 IPv4 + 2 port)
    // There should be a length check before reading request[4..7] for IPv4
    expect(content).toMatch(/request\.length\s*<\s*10/);
  });

  it('validates request packet length for domain name address type', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/tunnel-handlers.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // For domain (0x03): needs length check using domainLen
    // The parser should validate that request.length >= 5 + domainLen + 2
    expect(content).toMatch(/request\.length\s*<\s*(?:5\s*\+\s*domainLen\s*\+\s*2|7\s*\+\s*domainLen)/);
  });

  it('validates request packet length for IPv6 address type', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/tunnel-handlers.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // For IPv6 (0x04): needs at least 22 bytes (4 header + 16 IPv6 + 2 port)
    expect(content).toMatch(/request\.length\s*<\s*22/);
  });

  it('validates request packet minimum length before accessing header fields', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/tunnel-handlers.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Before checking request[0], request[1], request[3], verify minimum header length (4 bytes)
    expect(content).toMatch(/request\.length\s*<\s*4/);
  });
});

// ---------------------------------------------------------------------------
// #2104 — Enrollment token max_uses must use atomic check+increment
// ---------------------------------------------------------------------------
describe('#2104: Enrollment token max_uses race condition', () => {
  it('API enroll route uses atomic UPDATE...WHERE for uses check+increment', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // The enroll endpoint should use an atomic UPDATE...WHERE uses < max_uses
    // or UPDATE...WHERE current_uses < max_uses RETURNING id in a single query
    // instead of separate SELECT + check + UPDATE
    expect(content).toMatch(
      /UPDATE\s+terminal_enrollment_token\s+SET\s+uses\s*=\s*uses\s*\+\s*1\s+WHERE\s+id\s*=\s*\$\d+\s+AND\s+\(/i,
    );
  });

  it('SSH enrollment server uses atomic UPDATE...WHERE for uses check+increment', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/enrollment-ssh-server.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Same fix needed in the SSH enrollment path
    expect(content).toMatch(
      /UPDATE\s+terminal_enrollment_token\s+SET\s+uses\s*=\s*uses\s*\+\s*1\s+WHERE\s+id\s*=\s*\$\d+\s+AND\s+\(/i,
    );
  });
});

// ---------------------------------------------------------------------------
// #2105 — WebSocket auth token via query string logged with warning
// ---------------------------------------------------------------------------
describe('#2105: WebSocket auth token via query string (leak risk)', () => {
  it('logs a security warning when query param token is used', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // When query.token is used for WebSocket auth, a warning should be logged
    expect(content).toMatch(/console\.warn|logger\.warn|log\.warn/);
    // The warning should reference query param auth or token leak risk
    expect(content).toMatch(/query.*param|query.*token.*deprecat|query.*string.*auth/i);
  });
});

// ---------------------------------------------------------------------------
// #2106 — gRPC mTLS must NOT silently fall back to insecure when certs are configured
// ---------------------------------------------------------------------------
describe('#2106: gRPC mTLS silent fallback to insecure', () => {
  it('gRPC server throws on cert load failure when TLS is configured', () => {
    const filePath = path.join(SRC_ROOT, 'tmux-worker/grpc-server.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // When certPath && keyPath && caPath are set but loading fails,
    // the code must throw, not fall back to createInsecure()
    // The catch block should re-throw or call process.exit, not return createInsecure
    expect(content).not.toMatch(
      /catch\s*\([^)]*\)\s*\{[^}]*createInsecure/s,
    );
  });

  it('gRPC client throws on cert load failure when mTLS is configured', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/grpc-client.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Same: when env vars are set but loading fails, must throw
    expect(content).not.toMatch(
      /catch\s*\([^)]*\)\s*\{[^}]*createInsecure/s,
    );
  });
});

// ---------------------------------------------------------------------------
// #2107 — Known-host approve/reject must call gRPC BEFORE writing DB
// ---------------------------------------------------------------------------
describe('#2107: Known-host approve/reject writes DB before gRPC call', () => {
  it('approve route calls gRPC before writing to terminal_known_host', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Find the approve endpoint and verify gRPC call comes before DB insert
    // The grpcClient.approveHostKey call should appear BEFORE the INSERT INTO terminal_known_host
    const approveSection = content.slice(
      content.indexOf('known-hosts/approve'),
      content.indexOf('known-hosts/approve') + 3000,
    );

    const grpcCallIndex = approveSection.indexOf('grpcClient.approveHostKey');
    const dbInsertIndex = approveSection.indexOf('INSERT INTO terminal_known_host');

    expect(grpcCallIndex).toBeGreaterThan(-1);
    expect(dbInsertIndex).toBeGreaterThan(-1);
    // gRPC must come BEFORE DB write
    expect(grpcCallIndex).toBeLessThan(dbInsertIndex);
  });

  it('reject route calls gRPC before updating terminal_session', () => {
    const filePath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Find the reject endpoint section
    const rejectSection = content.slice(
      content.indexOf('known-hosts/reject'),
      content.indexOf('known-hosts/reject') + 2000,
    );

    const grpcCallIndex = rejectSection.indexOf('grpcClient.rejectHostKey');
    const dbUpdateIndex = rejectSection.indexOf("status = 'error'");

    expect(grpcCallIndex).toBeGreaterThan(-1);
    expect(dbUpdateIndex).toBeGreaterThan(-1);
    // gRPC must come BEFORE DB write
    expect(grpcCallIndex).toBeLessThan(dbUpdateIndex);
  });
});

// ---------------------------------------------------------------------------
// #2108 — openssh-server in runtime image
// ---------------------------------------------------------------------------
describe('#2108: openssh-server in runtime image', () => {
  it('documents why openssh-server is present OR removes it', () => {
    const filePath = path.join(DOCKER_ROOT, 'tmux-worker/Dockerfile');
    const content = fs.readFileSync(filePath, 'utf8');

    // Either openssh-server should be removed from the runtime stage,
    // or there should be a clear comment explaining why it's needed.
    const hasOpensshServer = content.includes('openssh-server');
    if (hasOpensshServer) {
      // Must have a comment explaining why
      expect(content).toMatch(/openssh-server.*#|#.*openssh-server|enrollment.*SSH.*server/i);
    }
    // If removed, test passes automatically
  });
});
