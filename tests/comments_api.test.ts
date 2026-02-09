import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Comments API endpoints (issue #182).
 */
describe('Comments API', () => {
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

    userEmail = `test-${Date.now()}@example.com`;

    const workItemRes = await pool.query(
      `INSERT INTO work_item (title, description, status)
       VALUES ('Test Item', 'Test description', 'open')
       RETURNING id`,
    );
    workItemId = workItemRes.rows[0].id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('work_item_comment table', () => {
    it('creates comment with required fields', async () => {
      const result = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'This is a comment')
         RETURNING *`,
        [workItemId, userEmail],
      );

      expect(result.rows[0]).toMatchObject({
        work_item_id: workItemId,
        user_email: userEmail,
        content: 'This is a comment',
      });
      expect(result.rows[0].mentions).toEqual([]);
      expect(result.rows[0].edited_at).toBeNull();
    });

    it('supports nested comments with parent_id', async () => {
      const parentResult = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Parent comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const parentId = parentResult.rows[0].id;

      const childResult = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content, parent_id)
         VALUES ($1, $2, 'Reply to parent', $3)
         RETURNING *`,
        [workItemId, userEmail, parentId],
      );

      expect(childResult.rows[0].parent_id).toBe(parentId);
    });

    it('stores mentions array', async () => {
      const mentions = ['alice@example.com', 'bob@example.com'];
      const result = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content, mentions)
         VALUES ($1, $2, 'Hey @alice and @bob!', $3)
         RETURNING *`,
        [workItemId, userEmail, mentions],
      );

      expect(result.rows[0].mentions).toEqual(mentions);
    });

    it('cascades delete when work item is deleted', async () => {
      await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')`,
        [workItemId, userEmail],
      );

      await pool.query(`DELETE FROM work_item WHERE id = $1`, [workItemId]);

      const result = await pool.query(`SELECT COUNT(*) FROM work_item_comment WHERE work_item_id = $1`, [workItemId]);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });

  describe('work_item_comment_reaction table', () => {
    it('creates reaction with emoji', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      const result = await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '👍')
         RETURNING *`,
        [commentId, userEmail],
      );

      expect(result.rows[0].emoji).toBe('👍');
    });

    it('enforces unique user+emoji per comment', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '👍')`,
        [commentId, userEmail],
      );

      await expect(
        pool.query(
          `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
           VALUES ($1, $2, '👍')`,
          [commentId, userEmail],
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('allows same user to add different emojis', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '👍')`,
        [commentId, userEmail],
      );

      const result = await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '❤️')
         RETURNING *`,
        [commentId, userEmail],
      );

      expect(result.rows[0].emoji).toBe('❤️');
    });
  });

  describe('user_presence table', () => {
    it('creates presence record', async () => {
      const result = await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id)
         VALUES ($1, $2)
         RETURNING *`,
        [userEmail, workItemId],
      );

      expect(result.rows[0].user_email).toBe(userEmail);
      expect(result.rows[0].work_item_id).toBe(workItemId);
    });

    it('enforces unique user+work_item', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id)
         VALUES ($1, $2)`,
        [userEmail, workItemId],
      );

      await expect(
        pool.query(
          `INSERT INTO user_presence (user_email, work_item_id)
           VALUES ($1, $2)`,
          [userEmail, workItemId],
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('allows upsert for presence update', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id)
         VALUES ($1, $2)
         ON CONFLICT (user_email, work_item_id) DO UPDATE SET last_seen_at = now()`,
        [userEmail, workItemId],
      );

      const result = await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id)
         VALUES ($1, $2)
         ON CONFLICT (user_email, work_item_id) DO UPDATE SET last_seen_at = now()
         RETURNING *`,
        [userEmail, workItemId],
      );

      expect(result.rows[0].user_email).toBe(userEmail);
    });
  });

  describe('GET /api/work-items/:id/comments', () => {
    it('returns empty array when no comments', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/comments`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.comments).toEqual([]);
    });

    it('returns comments for work item', async () => {
      await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'First comment'),
                ($1, $2, 'Second comment')`,
        [workItemId, userEmail],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/comments`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.comments).toHaveLength(2);
    });

    it('returns comments with reactions', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment with reactions')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '👍'), ($1, 'other@example.com', '❤️')`,
        [commentId, userEmail],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/comments`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.comments[0].reactions).toBeDefined();
      expect(body.comments[0].reactions['👍']).toBe(1);
      expect(body.comments[0].reactions['❤️']).toBe(1);
    });

    it('returns 404 for non-existent work item', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/comments',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/work-items/:id/comments', () => {
    it('creates a new comment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/comments`,
        payload: {
          userEmail,
          content: 'New comment',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.content).toBe('New comment');
    });

    it('creates a reply to a comment', async () => {
      const parentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Parent')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const parentId = parentRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/comments`,
        payload: {
          userEmail,
          content: 'Reply',
          parentId,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.parentId).toBe(parentId);
    });

    it('extracts mentions from content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/comments`,
        payload: {
          userEmail,
          content: 'Hey @alice@example.com and @bob@example.com!',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.mentions).toContain('alice@example.com');
      expect(body.mentions).toContain('bob@example.com');
    });
  });

  describe('PUT /api/work-items/:id/comments/:commentId', () => {
    it('updates comment content', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Original')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${workItemId}/comments/${commentId}`,
        payload: {
          userEmail,
          content: 'Updated content',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.content).toBe('Updated content');
      expect(body.editedAt).toBeDefined();
    });

    it('prevents updating other user comments', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, 'other@example.com', 'Other user comment')
         RETURNING id`,
        [workItemId],
      );
      const commentId = commentRes.rows[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${workItemId}/comments/${commentId}`,
        payload: {
          userEmail,
          content: 'Trying to update',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/work-items/:id/comments/:commentId', () => {
    it('deletes a comment', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'To delete')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/comments/${commentId}?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT COUNT(*) FROM work_item_comment WHERE id = $1', [commentId]);
      expect(parseInt(checkRes.rows[0].count)).toBe(0);
    });

    it('prevents deleting other user comments', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, 'other@example.com', 'Other comment')
         RETURNING id`,
        [workItemId],
      );
      const commentId = commentRes.rows[0].id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/comments/${commentId}?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/work-items/:id/comments/:commentId/reactions', () => {
    it('adds a reaction to a comment', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/comments/${commentId}/reactions`,
        payload: {
          userEmail,
          emoji: '👍',
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('toggles reaction off if already exists', async () => {
      const commentRes = await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, $2, 'Comment')
         RETURNING id`,
        [workItemId, userEmail],
      );
      const commentId = commentRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
         VALUES ($1, $2, '👍')`,
        [commentId, userEmail],
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/comments/${commentId}/reactions`,
        payload: {
          userEmail,
          emoji: '👍',
        },
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT COUNT(*) FROM work_item_comment_reaction WHERE comment_id = $1 AND user_email = $2', [commentId, userEmail]);
      expect(parseInt(checkRes.rows[0].count)).toBe(0);
    });
  });

  describe('GET /api/work-items/:id/presence', () => {
    it('returns empty array when no presence', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/presence`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users).toEqual([]);
    });

    it('returns users currently viewing', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id, last_seen_at)
         VALUES ($1, $2, now())`,
        [userEmail, workItemId],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/presence`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users).toHaveLength(1);
      expect(body.users[0].email).toBe(userEmail);
    });

    it('excludes stale presence (>5 minutes old)', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id, last_seen_at)
         VALUES ($1, $2, now() - interval '10 minutes')`,
        [userEmail, workItemId],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/presence`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users).toHaveLength(0);
    });
  });

  describe('POST /api/work-items/:id/presence', () => {
    it('updates user presence', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/presence`,
        payload: {
          userEmail,
        },
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT COUNT(*) FROM user_presence WHERE user_email = $1 AND work_item_id = $2', [userEmail, workItemId]);
      expect(parseInt(checkRes.rows[0].count)).toBe(1);
    });

    it('updates last_seen_at on subsequent calls', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id, last_seen_at)
         VALUES ($1, $2, now() - interval '1 minute')`,
        [userEmail, workItemId],
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/presence`,
        payload: {
          userEmail,
        },
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query(
        `SELECT last_seen_at FROM user_presence
         WHERE user_email = $1 AND work_item_id = $2`,
        [userEmail, workItemId],
      );
      const lastSeen = new Date(checkRes.rows[0].last_seen_at);
      const now = new Date();
      expect(now.getTime() - lastSeen.getTime()).toBeLessThan(5000);
    });
  });

  describe('DELETE /api/work-items/:id/presence', () => {
    it('removes user presence', async () => {
      await pool.query(
        `INSERT INTO user_presence (user_email, work_item_id)
         VALUES ($1, $2)`,
        [userEmail, workItemId],
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/presence?userEmail=${encodeURIComponent(userEmail)}`,
      });

      expect(response.statusCode).toBe(200);

      const checkRes = await pool.query('SELECT COUNT(*) FROM user_presence WHERE user_email = $1 AND work_item_id = $2', [userEmail, workItemId]);
      expect(parseInt(checkRes.rows[0].count)).toBe(0);
    });
  });

  describe('GET /api/users/search', () => {
    it('returns users matching search query', async () => {
      // Create some comments from different users to populate user data
      await pool.query(
        `INSERT INTO work_item_comment (work_item_id, user_email, content)
         VALUES ($1, 'alice@example.com', 'Comment 1'),
                ($1, 'bob@example.com', 'Comment 2'),
                ($1, 'alice.smith@company.com', 'Comment 3')`,
        [workItemId],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/users/search?q=alice',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users.length).toBeGreaterThanOrEqual(2);
      expect(body.users.every((u: { email: string }) => u.email.includes('alice'))).toBe(true);
    });

    it('limits results', async () => {
      for (let i = 0; i < 20; i++) {
        await pool.query(
          `INSERT INTO work_item_comment (work_item_id, user_email, content)
           VALUES ($1, $2, 'Comment')`,
          [workItemId, `user${i}@example.com`],
        );
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/users/search?q=user&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users.length).toBe(5);
    });
  });
});
