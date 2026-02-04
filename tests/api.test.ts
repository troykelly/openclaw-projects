import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Backend API service', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('exposes /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('can create and fetch a work item', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'API item', description: 'via api' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);

    const fetched = await app.inject({ method: 'GET', url: `/api/work-items/${body.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().title).toBe('API item');
  });

  it('supports update + delete for work items', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'To update', description: 'a' },
    });
    const { id } = created.json() as { id: string };

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/work-items/${id}`,
      payload: {
        title: 'Updated title',
        description: 'b',
        status: 'blocked',
        priority: 'P1',
        taskType: 'ops',
        notBefore: null,
        notAfter: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().title).toBe('Updated title');
    expect(updated.json().priority).toBe('P1');

    const del = await app.inject({ method: 'DELETE', url: `/api/work-items/${id}` });
    expect(del.statusCode).toBe(204);

    const fetched = await app.inject({ method: 'GET', url: `/api/work-items/${id}` });
    expect(fetched.statusCode).toBe(404);
  });

  it('supports dependencies + participants CRUD', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/work-items', payload: { title: 'A' } });
    const b = await app.inject({ method: 'POST', url: '/api/work-items', payload: { title: 'B' } });
    const c = await app.inject({ method: 'POST', url: '/api/work-items', payload: { title: 'C' } });
    const aId = (a.json() as { id: string }).id;
    const bId = (b.json() as { id: string }).id;
    const cId = (c.json() as { id: string }).id;

    const dep = await app.inject({
      method: 'POST',
      url: `/api/work-items/${bId}/dependencies`,
      payload: { dependsOnWorkItemId: aId, kind: 'depends_on' },
    });
    expect(dep.statusCode).toBe(201);
    const depId = (dep.json() as { id: string }).id;

    const dep2 = await app.inject({
      method: 'POST',
      url: `/api/work-items/${cId}/dependencies`,
      payload: { dependsOnWorkItemId: bId, kind: 'depends_on' },
    });
    expect(dep2.statusCode).toBe(201);

    // Reject cycles: if C -> B -> A, then A cannot depend on C.
    const cycle = await app.inject({
      method: 'POST',
      url: `/api/work-items/${aId}/dependencies`,
      payload: { dependsOnWorkItemId: cId, kind: 'depends_on' },
    });
    expect(cycle.statusCode).toBe(400);

    const deps = await app.inject({ method: 'GET', url: `/api/work-items/${bId}/dependencies` });
    expect(deps.statusCode).toBe(200);
    expect((deps.json() as { items: unknown[] }).items.length).toBe(1);

    const depDel = await app.inject({
      method: 'DELETE',
      url: `/api/work-items/${bId}/dependencies/${depId}`,
    });
    expect(depDel.statusCode).toBe(204);

    const p = await app.inject({
      method: 'POST',
      url: `/api/work-items/${bId}/participants`,
      payload: { participant: 'troy@example.com', role: 'watcher' },
    });
    expect(p.statusCode).toBe(201);
    const pid = (p.json() as { id: string }).id;

    const plist = await app.inject({ method: 'GET', url: `/api/work-items/${bId}/participants` });
    expect(plist.statusCode).toBe(200);
    expect((plist.json() as { items: Array<{ participant: string }> }).items[0].participant).toBe('troy@example.com');

    const pdel = await app.inject({ method: 'DELETE', url: `/api/work-items/${bId}/participants/${pid}` });
    expect(pdel.statusCode).toBe(204);
  });

  it('auto-sets not_before when adding a depends_on dependency', async () => {
    const blocker = await app.inject({ method: 'POST', url: '/api/work-items', payload: { title: 'Blocker' } });
    const dependent = await app.inject({ method: 'POST', url: '/api/work-items', payload: { title: 'Dependent' } });

    const blockerId = (blocker.json() as { id: string }).id;
    const dependentId = (dependent.json() as { id: string }).id;

    const blockerEnd = '2026-01-01T00:00:00.000Z';

    const updatedBlocker = await app.inject({
      method: 'PUT',
      url: `/api/work-items/${blockerId}`,
      payload: {
        title: 'Blocker',
        description: null,
        status: 'open',
        priority: 'P2',
        taskType: 'general',
        notBefore: null,
        notAfter: blockerEnd,
      },
    });
    expect(updatedBlocker.statusCode).toBe(200);

    const dep = await app.inject({
      method: 'POST',
      url: `/api/work-items/${dependentId}/dependencies`,
      payload: { dependsOnWorkItemId: blockerId, kind: 'depends_on' },
    });
    expect(dep.statusCode).toBe(201);

    const fetched = await app.inject({ method: 'GET', url: `/api/work-items/${dependentId}` });
    expect(fetched.statusCode).toBe(200);

    const body = fetched.json() as { not_before: string | null };
    expect(body.not_before).not.toBeNull();
    expect(new Date(body.not_before as string).toISOString()).toBe(blockerEnd);
  });

  it('can ingest an external message (contact+endpoint+thread+message)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/external-message',
      payload: {
        contactDisplayName: 'Test Sender',
        endpointType: 'telegram',
        endpointValue: '@TestSender',
        externalThreadKey: 'thread-1',
        externalMessageKey: 'msg-1',
        direction: 'inbound',
        messageBody: 'Hello',
        raw: { any: 'payload' },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contactId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.endpointId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.threadId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
