-- Migration 167: Clear corrupted Yjs state entries (#2562)
--
-- Pre-#2472 notes have yjs_state that stored content at the wrong key ('default'
-- instead of 'root'). When the client loads these documents, the CollaborationPlugin
-- finds no content at the 'root' key and shows an empty editor. The shouldBootstrap
-- fix (#2482) tries to bootstrap from note.content, but the content column contains
-- raw XML serialization from Y.XmlText.toString(), not markdown. Passing XML to
-- $convertFromMarkdownString produces blank output.
--
-- Fix: Clear yjs_state only for notes whose content column contains raw XML
-- serialization (starts with '<') — the hallmark of the pre-#2472 corruption.
-- Healthy notes (markdown content) keep their Yjs snapshots intact.
--
-- This forces the client-side CollaborationPlugin to bootstrap corrupted notes
-- from the content column via initialEditorState. The companion frontend fix
-- ensures the bootstrap function handles both markdown and XML content correctly.
--
-- This is safe because:
-- 1. The content column is always kept in sync with yjs_state
-- 2. Clearing yjs_state means the next editor open re-initializes from content
-- 3. Only corrupted notes (XML content) are affected

UPDATE note
SET yjs_state = NULL
WHERE yjs_state IS NOT NULL
  AND content IS NOT NULL
  AND content LIKE '<%';
