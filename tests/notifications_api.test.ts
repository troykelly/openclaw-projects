import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, ensureTestNamespace, truncateAllTables } from './helpers/db.ts';
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

    it('filters unread count by namespaces', async () => {
      await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, namespace)
         VALUES ($1, 'assigned', 'Home notif', 'Home message', 'home'),
                ($1, 'mentioned', 'Work notif', 'Work message', 'work')`,
        [user_email],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/notifications/unread-count?user_email=${encodeURIComponent(user_email)}&namespaces=home`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.unread_count).toBe(1);
    });
  });

  // ===== Namespace scoping tests (Issue #1480) =====
  describe('Namespace scoping (Issue #1480)', () => {
    it('notification table has namespace column with default value', async () => {
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message)
         VALUES ($1, 'assigned', 'Title', 'Message')
         RETURNING namespace`,
        [user_email],
      );

      expect(result.rows[0].namespace).toBe('default');
    });

    it('notification table accepts explicit namespace', async () => {
      const result = await pool.query(
        `INSERT INTO notification (user_email, notification_type, title, message, namespace)
         VALUES ($1, 'assigned', 'Title', 'Message', 'household')
         RETURNING namespace`,
        [user_email],
      );

      expect(result.rows[0].namespace).toBe('household');
    });

    it('enforces namespace naming pattern', async () => {
      await expect(
        pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace)
           VALUES ($1, 'assigned', 'Title', 'Message', 'INVALID NAMESPACE!')`,
          [user_email],
        ),
      ).rejects.toThrow();
    });

    describe('GET /api/notifications with namespaces filter', () => {
      beforeEach(async () => {
        // Insert notifications in different namespaces
        await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace)
           VALUES ($1, 'assigned', 'Home task', 'Home message', 'home'),
                  ($1, 'mentioned', 'Work task', 'Work message', 'work'),
                  ($1, 'comment', 'Default task', 'Default message', 'default')`,
          [user_email],
        );
      });

      it('returns all namespaces when no filter', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.notifications).toHaveLength(3);
      });

      it('filters by single namespace', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&namespaces=home`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.notifications).toHaveLength(1);
        expect(body.notifications[0].title).toBe('Home task');
        expect(body.notifications[0].namespace).toBe('home');
      });

      it('filters by multiple namespaces (comma-separated)', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&namespaces=home,work`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.notifications).toHaveLength(2);
        const titles = body.notifications.map((n: { title: string }) => n.title).sort();
        expect(titles).toEqual(['Home task', 'Work task']);
      });

      it('returns empty when filtering by non-matching namespace', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&namespaces=nonexistent`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.notifications).toHaveLength(0);
      });

      it('unread_count respects namespace filter', async () => {
        // Mark one as read
        await pool.query(
          `UPDATE notification SET read_at = now() WHERE user_email = $1 AND namespace = 'home'`,
          [user_email],
        );

        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}&namespaces=home,work`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        // home is read, work is unread — among the filtered set
        expect(body.unread_count).toBe(1);
      });
    });

    describe('namespace field in notification responses', () => {
      it('includes namespace in GET /api/notifications response', async () => {
        await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace)
           VALUES ($1, 'assigned', 'Title', 'Message', 'household')`,
          [user_email],
        );

        const response = await app.inject({
          method: 'GET',
          url: `/api/notifications?user_email=${encodeURIComponent(user_email)}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.notifications[0].namespace).toBe('household');
      });
    });

    describe('namespace-aware fanout (notification creation)', () => {
      it('creates notification with explicit namespace', async () => {
        const result = await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace, work_item_id)
           VALUES ($1, 'assigned', 'Task assigned', 'You have a new task', 'household', $2)
           RETURNING *`,
          [user_email, work_item_id],
        );

        expect(result.rows[0].namespace).toBe('household');
        expect(result.rows[0].user_email).toBe(user_email);
      });

      it('resolves namespace members from namespace_grant for system notifications', async () => {
        // Set up two users in the same namespace (insert directly to avoid pool deadlock)
        const user1 = 'user1@example.com';
        const user2 = 'user2@example.com';

        await pool.query(
          `INSERT INTO user_setting (email) VALUES ($1), ($2)
           ON CONFLICT (email) DO NOTHING`,
          [user1, user2],
        );
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home)
           VALUES ($1, 'team-ns', 'readwrite', true), ($2, 'team-ns', 'read', false)
           ON CONFLICT (email, namespace) DO NOTHING`,
          [user1, user2],
        );

        // Verify both users have grants
        const grants = await pool.query(
          `SELECT email FROM namespace_grant WHERE namespace = 'team-ns' ORDER BY email`,
        );
        expect(grants.rows).toHaveLength(2);
        expect(grants.rows.map((r: { email: string }) => r.email)).toEqual([user1, user2]);
      });
    });

    describe('POST /api/notifications/read-all with namespace filter', () => {
      it('marks all as read respects user_email scope', async () => {
        const otherEmail = 'other-user@example.com';
        // Insert notifications for current user and another user
        await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace)
           VALUES ($1, 'assigned', 'Mine', 'My notif', 'home')`,
          [user_email],
        );
        await pool.query(
          `INSERT INTO notification (user_email, notification_type, title, message, namespace)
           VALUES ($1, 'assigned', 'Theirs', 'Their notif', 'home')`,
          [otherEmail],
        );

        // Verify both exist before read-all
        const beforeCount = await pool.query(`SELECT COUNT(*) FROM notification`);
        expect(Number.parseInt(beforeCount.rows[0].count, 10)).toBe(2);

        const response = await app.inject({
          method: 'POST',
          url: `/api/notifications/read-all?user_email=${encodeURIComponent(user_email)}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.marked_count).toBe(1);

        // Other user's notification should still be unread
        const checkRes = await pool.query(
          `SELECT read_at FROM notification WHERE user_email = $1`,
          [otherEmail],
        );
        expect(checkRes.rows).toHaveLength(1);
        expect(checkRes.rows[0].read_at).toBeNull();
      });
    });
  });
});
