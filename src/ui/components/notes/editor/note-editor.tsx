/**
 * Note editor component with WYSIWYG and markdown support.
 * Part of Epic #338, Issues #350, #629
 *
 * This module now uses Lexical for true WYSIWYG editing while maintaining
 * backward compatibility with the existing interface.
 *
 * Features:
 * - Rich text editing with Lexical
 * - Markdown source view toggle
 * - Auto-save with debounce
 * - Keyboard shortcuts
 *
 * Security: Preview mode uses simple markdown-to-HTML conversion.
 * In production, sanitize HTML with DOMPurify to prevent XSS.
 */

// Re-export the Lexical editor as the main NoteEditor
export {
  LexicalNoteEditor as NoteEditor,
  type LexicalEditorProps as NoteEditorProps,
  type EditorMode,
} from './lexical-editor';
