import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'http';

describe('Dual-stack binding on ::', () => {
  let server: Server;
  let port: number;

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it('accepts connections on both IPv4 (127.0.0.1) and IPv6 ([::1])', async () => {
    // Start server on :: (dual-stack)
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '::', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });

    // Test IPv4 access
    const ipv4Resp = await fetch(`http://127.0.0.1:${port}/`);
    expect(ipv4Resp.status).toBe(200);
    expect(await ipv4Resp.text()).toBe('ok');

    // Test IPv6 access
    const ipv6Resp = await fetch(`http://[::1]:${port}/`);
    expect(ipv6Resp.status).toBe(200);
    expect(await ipv6Resp.text()).toBe('ok');
  });
});
