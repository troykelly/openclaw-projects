-- Migration 167: Clear corrupted Yjs state entries (#2562)
--
-- Pre-#2472 notes have yjs_state that stored content at the wrong key ('default'
-- instead of 'root'). When the client loads these documents, the CollaborationPlugin
-- finds no content at the 'root' key and shows an empty editor. The shouldBootstrap
-- fix (#2482) tries to bootstrap from note.content, but the content column contains
-- raw XML serialization from Y.XmlText.toString(), not markdown. Passing XML to
-- $convertFromMarkdownString produces blank output.
--
-- Fix: Clear yjs_state for all notes that have it. This forces the client-side
-- CollaborationPlugin to bootstrap from the note.content column via initialEditorState.
-- The companion frontend fix ensures the bootstrap function handles both markdown
-- and XML content correctly.
--
-- This is safe because:
-- 1. The content column is always kept in sync with yjs_state (it's the derived
--    markdown/XML projection)
-- 2. Clearing yjs_state just means the next editor open will re-initialize from content
-- 3. Any active Yjs sessions will persist their state on next edit

UPDATE note
SET yjs_state = NULL
WHERE yjs_state IS NOT NULL;
