/**
 * Unit tests for SSH config parser.
 * Issue #1672 — Connection CRUD API (import-ssh-config endpoint).
 */

import { describe, it, expect } from 'vitest';
import { parseSSHConfig } from './ssh-config-parser.ts';

describe('parseSSHConfig', () => {
  it('parses a single host entry', () => {
    const config = `
Host myserver
  Hostname 192.168.1.100
  User admin
  Port 2222
  IdentityFile ~/.ssh/id_rsa
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'myserver',
      host: '192.168.1.100',
      port: 2222,
      username: 'admin',
      identityFile: '~/.ssh/id_rsa',
      proxyJump: null,
    });
  });

  it('parses multiple host entries', () => {
    const config = `
Host web1
  Hostname web1.example.com
  User deploy

Host web2
  Hostname web2.example.com
  User deploy
  Port 22
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('web1');
    expect(result[0].host).toBe('web1.example.com');
    expect(result[1].name).toBe('web2');
    expect(result[1].host).toBe('web2.example.com');
  });

  it('skips wildcard hosts', () => {
    const config = `
Host *
  ServerAliveInterval 60

Host myserver
  Hostname example.com
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('myserver');
  });

  it('handles host with ProxyJump', () => {
    const config = `
Host internal
  Hostname 10.0.0.5
  ProxyJump bastion
  User root
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].proxyJump).toBe('bastion');
  });

  it('defaults port to 22', () => {
    const config = `
Host simple
  Hostname simple.example.com
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(22);
  });

  it('skips comments and empty lines', () => {
    const config = `
# This is a comment
Host myhost
  # Comment inside block
  Hostname 1.2.3.4
  User testuser

  # Another comment
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].host).toBe('1.2.3.4');
    expect(result[0].username).toBe('testuser');
  });

  it('returns empty array for empty input', () => {
    expect(parseSSHConfig('')).toEqual([]);
    expect(parseSSHConfig('# only comments\n')).toEqual([]);
  });

  it('handles host without hostname (uses name as host)', () => {
    const config = `
Host myserver
  User root
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('myserver');
    expect(result[0].host).toBeNull();
  });

  it('skips question mark wildcards', () => {
    const config = `
Host web?
  User deploy

Host production
  Hostname prod.example.com
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('production');
  });

  it('handles invalid port gracefully', () => {
    const config = `
Host broken
  Hostname broken.example.com
  Port abc
`;
    const result = parseSSHConfig(config);
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(22); // Falls back to default
  });
});
