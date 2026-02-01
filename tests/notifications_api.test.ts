import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Notifications API endpoints (issue #181).
 */
describe('Notifications API', () => {
  const app = buildServer();
  let pool: Pool;
  let userEmail: string;
  let workItemId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Set up test user email
    userEmail = `test-${Date.now()}@example.com`;

    // Create a test work item for notifications
    const workItemRes = await pool.query(
      `INSERT INTO work_item (title, description, status)
       VALUES ('Test Item', 'Test description', 'open')
       RETURNING id`
    );
    workItemId = workItemRes.rows[0].id;
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
        [userEmail]
      );

      expect(result.rows[0]).toMatchObject({
        user_email: userEmail,
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
        [userEmail, workItemId]
      );

      expect(result.rows[0].work_item_id).toBe(workItemId);
    });

    it('stores metadata as JSONB', async () => {
      const metadata = { old_status: 'todo', new_status: 'in_progress' };
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, metadata)
         VALUES ($1, 'status_change', 'Status changed', 'Message', $2)
         RETURNING *`,
        [userEmail, JSON.stringify(metadata)]
      );

      expect(result.rows[0].metadata).toEqual(metadata);
    });

    it('validates notification type enum', async () => {
      await expect(
        pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message)
           VALUES ($1, 'invalid_type', 'Title', 'Message')`,
          [userEmail]
        )
      ).rejects.toThrow(/invalid input value for enum notification_type/);
    });

    it('cascades delete when work item is deleted', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, work_item_id)
         VALUES ($1, 'assigned', 'Title', 'Message', $2)`,
        [userEmail, workItemId]
      );

      await pool.query(`DELETE FROM work_item WHERE id = $1`, [workItemId]);

      const result = await pool.query(
        `SELECT COUNT(*) FROM notification WHERE work_item_id = $1`,
        [workItemId]
      );
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });

  describe('notification_preference table', () => {
    it('creates preference with defaults', async () => {
      const result = await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type)
         VALUES ($1, 'assigned')
         RETURNING *`,
        [userEmail]
      );

      expect(result.rows[0]).toMatchObject({
        user_email: userEmail,
        notification_type: 'assigned',
        in_app_enabled: true,
        email_enabled: false,
      });
    });

    it('enforces unique user + type constraint', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type)
         VALUES ($1, 'assigned')`,
        [userEmail]
      );

      await expect(
        pool.query(
          `INSERT INTO notification_preference (user_email, notification_type)
           VALUES ($1, 'assigned')`,
          [userEmail]
        )
      ).rejects.toThrow(/duplicate key/);
    });

    it('allows upsert pattern', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled)
         VALUES ($1, 'mentioned', true)
         ON CONFLICT (user_email, notification_type) DO UPDATE SET in_app_enabled = EXCLUDED.in_app_enabled`,
        [userEmail]
      );

      const result = await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled, email_enabled)
         VALUES ($1, 'mentioned', false, true)
         ON CONFLICT (user_email, notification_type) DO UPDATE SET
           in_app_enabled = EXCLUDED.in_app_enabled,
           email_enabled = EXCLUDED.email_enabled
         RETURNING *`,
        [userEmail]
      );

      expect(result.rows[0].in_app_enabled).toBe(false);
      expect(result.rows[0].email_enabled).toBe(true);
    });
  });

  describe('GET /api/notifications', () => {
    it('returns empty array when no notifications', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toEqual([]);
      expect(body.unreadCount).toBe(0);
    });

    it('returns notifications for the user', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, work_item_id, actor_email)
         VALUES ($1, 'assigned', 'Assigned to you', 'Test Item was assigned to you', $2, 'someone@example.com')`,
        [userEmail, workItemId]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].title).toBe('Assigned to you');
      expect(body.notifications[0].notificationType).toBe('assigned');
      expect(body.unreadCount).toBe(1);
    });

    it('filters by unread only', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, read_at)
         VALUES ($1, 'assigned', 'Read notification', 'Already read', now())`,
        [userEmail]
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Unread notification', 'Not yet read')`,
        [userEmail]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?userEmail=${encodeURIComponent(userEmail)}&unreadOnly=true`,
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
          [userEmail, `Notification ${i}`]
        );
      }

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?userEmail=${encodeURIComponent(userEmail)}&limit=2&offset=1`,
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
        [userEmail]
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Active notification', 'Active')`,
        [userEmail]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications?userEmail=${encodeURIComponent(userEmail)}`,
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
        [userEmail]
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/${notificationId}/read?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query(
        'SELECT read_at FROM notification WHERE id = $1',
        [notificationId]
      );
      expect(checkRes.rows[0].read_at).not.toBeNull();
    });

    it('returns 404 for non-existent notification', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/00000000-0000-0000-0000-000000000000/read?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for other user notification', async () => {
      const otherUserEmail = 'other@example.com';

      const insertRes = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test', 'Test message')
         RETURNING id`,
        [otherUserEmail]
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/${notificationId}/read?userEmail=${encodeURIComponent(userEmail)}`,
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
        [userEmail]
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/notifications/read-all?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.markedCount).toBe(3);

      const checkRes = await pool.query(
        'SELECT COUNT(*) FROM notification WHERE user_email = $1 AND read_at IS NULL',
        [userEmail]
      );
      expect(parseInt(checkRes.rows[0].count)).toBe(0);
    });
  });

  describe('DELETE /api/notifications/:id', () => {
    it('dismisses a notification', async () => {
      const insertRes = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Test', 'Test message')
         RETURNING id`,
        [userEmail]
      );
      const notificationId = insertRes.rows[0].id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/notifications/${notificationId}?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query(
        'SELECT dismissed_at FROM notification WHERE id = $1',
        [notificationId]
      );
      expect(checkRes.rows[0].dismissed_at).not.toBeNull();
    });
  });

  describe('GET /api/notifications/preferences', () => {
    it('returns default preferences when none set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/preferences?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preferences).toBeDefined();
      expect(body.preferences.assigned).toEqual({ inApp: true, email: false });
      expect(body.preferences.mentioned).toEqual({ inApp: true, email: false });
    });

    it('returns user-specific preferences', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled, email_enabled)
         VALUES ($1, 'assigned', false, true)`,
        [userEmail]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/preferences?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preferences.assigned).toEqual({ inApp: false, email: true });
    });
  });

  describe('PATCH /api/notifications/preferences', () => {
    it('updates notification preferences', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/preferences?userEmail=${encodeURIComponent(userEmail)}`,
        payload: {
          assigned: { inApp: false, email: true },
          mentioned: { inApp: true, email: true },
        },
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query(
        `SELECT notification_type, in_app_enabled, email_enabled
         FROM notification_preference
         WHERE user_email = $1
         ORDER BY notification_type`,
        [userEmail]
      );

      const prefs = checkRes.rows.reduce((acc: Record<string, { inApp: boolean; email: boolean }>, row) => {
        acc[row.notification_type] = { inApp: row.in_app_enabled, email: row.email_enabled };
        return acc;
      }, {});

      expect(prefs.assigned).toEqual({ inApp: false, email: true });
      expect(prefs.mentioned).toEqual({ inApp: true, email: true });
    });

    it('validates notification type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/preferences?userEmail=${encodeURIComponent(userEmail)}`,
        payload: {
          invalid_type: { inApp: false, email: true },
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
        [userEmail]
      );
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'mentioned', 'Unread 1', 'Unread message 1'),
                ($1, 'comment', 'Unread 2', 'Unread message 2')`,
        [userEmail]
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/unread-count?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.unreadCount).toBe(2);
    });
  });
});
