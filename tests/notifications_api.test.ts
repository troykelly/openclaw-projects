import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Notifications API endpoints (issue #181).
 */
describe('Notifications API', () => {
  const app = buildServer();
  let pool: Pool;
  let user_email: string;
  let work_item_id: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Set up test user email
    user_email = `test-${Date.now()}@example.com`;

    // Create a test work item for notifications
    const workItemRes = await pool.query(
      `INSERT INTO work_item (title, description, status)
       VALUES ('Test Item', 'Test description', 'open')
       RETURNING id`,
    );
    work_item_id = workItemRes.rows[0].id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('notification table', () => {
    it('creates notification with required fields', async () => {
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Assigned to you', 'Test Item was assigned to you')
         RETURNING *`,
        [user_email],
      );

      expect(result.rows[0]).toMatchObject({
        user_email: user_email,
        notification_type: 'assigned',
        title: 'Assigned to you',
        message: 'Test Item was assigned to you',
      });
      expect(result.rows[0].read_at).toBeNull();
      expect(result.rows[0].dismissed_at).toBeNull();
    });

    it('links notification to work item', async () => {
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, work_item_id)
         VALUES ($1, 'assigned', 'Assigned to you', 'Message', $2)
         RETURNING *`,
        [user_email, work_item_id],
      );

      expect(result.rows[0].work_item_id).toBe(work_item_id);
    });

    it('stores metadata as JSONB', async () => {
      const metadata = { old_status: 'todo', new_status: 'in_progress' };
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, metadata)
         VALUES ($1, 'status_change', 'Status changed', 'Message', $2)
         RETURNING *`,
        [user_email, JSON.stringify(metadata)],
      );

      expect(result.rows[0].metadata).toEqual(metadata);
    });

    it('validates notification type enum', async () => {
      await expect(
        pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message)
           VALUES ($1, 'invalid_type', 'Title', 'Message')`,
          [user_email],
        ),
      ).rejects.toThrow(/invalid input value for enum notification_type/);
    });

    it('cascades delete when work item is deleted', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, work_item_id)
         VALUES ($1, 'assigned', 'Title', 'Message', $2)`,
        [user_email, work_item_id],
      );

      await pool.query(`DELETE FROM work_item WHERE id = $1`, [work_item_id]);

      const result = await pool.query(`SELECT COUNT(*) FROM notification WHERE work_item_id = $1`, [work_item_id]);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });

  describe('notification_preference table', () => {
    it('creates preference with defaults', async () => {
      const result = await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type)
         VALUES ($1, 'assigned')
         RETURNING *`,
        [user_email],
      );

      expect(result.rows[0]).toMatchObject({
        user_email: user_email,
        notification_type: 'assigned',
        in_app_enabled: true,
        email_enabled: false,
      });
    });

    it('enforces unique user + type constraint', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type)
         VALUES ($1, 'assigned')`,
        [user_email],
      );

      await expect(
        pool.query(
          `INSERT INTO notification_preference (user_email, notification_type)
           VALUES ($1, 'assigned')`,
          [user_email],
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('allows upsert pattern', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled)
         VALUES ($1, 'mentioned', true)
         ON CONFLICT (user_email, notification_type) DO UPDATE SET in_app_enabled = EXCLUDED.in_app_enabled`,
        [user_email],
      );

      const result = await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled, email_enabled)
         VALUES ($1, 'mentioned', false, true)
         ON CONFLICT (user_email, notification_type) DO UPDATE SET
           in_app_enabled = EXCLUDED.in_app_enabled,
           email_enabled = EXCLUDED.email_enabled
         RETURNING *`,
        [user_email],
      );

      expect(result.rows[0].in_app_enabled).toBe(false);
      expect(result.rows[0].email_enabled).toBe(true);
    });
  });

  describe('GET /api/notifications', () => {
    it('returns empty array when no notifications', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toEqual([]);
      expect(body.unread_count).toBe(0);
    });

    it('returns notifications for the user', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, work_item_id, actor_email)
         VALUES ($1, 'assigned', 'Assigned to you', 'Test Item was assigned to you', $2, 'someone@example.com')`,
        [user_email, work_item_id],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('Assigned to you');
      expect(body.notifications[0].notification_type).toBe('assigned');
      expect(body.unread_count).toBe(1);
    });

    it('filters by unread only', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, read_at)
         VALUES ($1, 'assigned', 'Read notification', 'Already read', now())`,
        [user_email],
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Unread notification', 'Not yet read')`,
        [user_email],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&unread_only=true`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('Unread notification');
    });

    it('supports pagination with limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, created_at)
           VALUES ($1, 'comment', $2, 'Message', now() - interval '${6 - i} minutes')`,
          [user_email, `Notification ${i}`],
        );
      }

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&limit=2&offset=1`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(2);
      expect(body.notifications[0].title).toBe('Notification 4');
      expect(body.notifications[1].title).toBe('Notification 3');
    });

    it('excludes dismissed notifications by default', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, dismissed_at)
         VALUES ($1, 'assigned', 'Dismissed notification', 'Dismissed', now())`,
        [user_email],
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Active notification', 'Active')`,
        [user_email],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('Active notification');
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    it('marks a notification as read', async () => {
      const insertRes = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test', 'Test message')
         RETURNING id`,
        [user_email],
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/${notificationId}/read?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT read_at FROM notification WHERE id = $1', [notificationId]);
      expect(checkRes.rows[0].read_at).not.toBeNull();
    });

    it('returns 404 for non-existent notification', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/00000000-0000-0000-0000-000000000000/read?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for other user notification', async () => {
      const otherUserEmail = 'other@example.com';

      const insertRes = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test', 'Test message')
         RETURNING id`,
        [otherUserEmail],
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/${notificationId}/read?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('marks all unread notifications as read', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test 1', 'Message 1'),
                ($1, 'mentioned', 'Test 2', 'Message 2'),
                ($1, 'comment', 'Test 3', 'Message 3')`,
        [user_email],
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/read-all?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.marked_count).toBe(3);

      const checkRes = await pool.query('SELECT COUNT(*) FROM notification WHERE user_email = $1 AND read_at IS NULL', [user_email]);
      expect(parseInt(checkRes.rows[0].count)).toBe(0);
    });
  });

  describe('DELETE /api/notifications/:id', () => {
    it('dismisses a notification', async () => {
      const insertRes = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test', 'Test message')
         RETURNING id`,
        [user_email],
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/notifications/${notificationId}?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT dismissed_at FROM notification WHERE id = $1', [notificationId]);
      expect(checkRes.rows[0].dismissed_at).not.toBeNull();
    });
  });

  describe('GET /api/notifications/preferences', () => {
    it('returns default preferences when none set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/preferences?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preferences).toBeDefined();
      expect(body.preferences.assigned).toEqual({ in_app: true, email: false });
      expect(body.preferences.mentioned).toEqual({ in_app: true, email: false });
    });

    it('returns user-specific preferences', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled, email_enabled)
         VALUES ($1, 'assigned', false, true)`,
        [user_email],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/preferences?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preferences.assigned).toEqual({ in_app: false, email: true });
    });
  });

  describe('PATCH /api/notifications/preferences', () => {
    it('updates notification preferences', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/preferences?user_email=${encodeURIComponent(user_email)}`,
        payload: {
          assigned: { in_app: false, email: true },
          mentioned: { in_app: true, email: true },
        },
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query(
        `SELECT notification_type, in_app_enabled, email_enabled
         FROM notification_preference
         WHERE user_email = $1
         ORDER BY notification_type`,
        [user_email],
      );

      const prefs = checkRes.rows.reduce((acc: Record<string, { in_app: boolean; email: boolean }>, row) => {
        acc[row.notification_type] = { in_app: row.in_app_enabled, email: row.email_enabled };
        return acc;
      }, {});

      expect(prefs.assigned).toEqual({ in_app: false, email: true });
      expect(prefs.mentioned).toEqual({ in_app: true, email: true });
    });

    it('validates notification type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/preferences?user_email=${encodeURIComponent(user_email)}`,
        payload: {
          invalid_type: { in_app: false, email: true },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('returns unread count', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, read_at)
         VALUES ($1, 'assigned', 'Read', 'Read message', now())`,
        [user_email],
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Unread 1', 'Unread message 1'),
                ($1, 'comment', 'Unread 2', 'Unread message 2')`,
        [user_email],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/unread-count?user_email=${encodeURIComponent(user_email)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.unread_count).toBe(2);
    });
  });
});
