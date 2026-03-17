/**
 * Server-side Yjs document bootstrap using headless Lexical editor.
 *
 * Per Lexical docs, collaborative content MUST be bootstrapped server-side —
 * client-side shouldBootstrap/initialEditorState causes error #94 when
 * syncChildrenFromLexical encounters mismatched node trees.
 *
 * Uses @lexical/headless to create a temporary editor, populate it with
 * content, then sync the Lexical state into the Yjs doc via createBinding.
 *
 * Issue #2602
 */

import * as Y from 'yjs';
import { createHeadlessEditor } from '@lexical/headless';
import { createBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical';
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';

/** No-op provider for headless binding — no network needed. */
const NOOP_PROVIDER = {
  awareness: { getLocalState: () => null, getStates: () => new Map(), on: () => {}, off: () => {} },
  connect: () => {},
  disconnect: () => {},
  on: () => {},
  off: () => {},
};

/**
 * Bootstrap a Yjs doc from plain text content using a headless Lexical editor.
 *
 * Creates proper Lexical node structure (ParagraphNode + TextNode) in the
 * Yjs doc so that CollaborationPlugin can sync without crashing.
 */
export function bootstrapYjsDocFromContent(doc: Y.Doc, content: string): void {
  // Create a headless editor with the same nodes as the client editor
  const editor = createHeadlessEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      CodeHighlightNode,
      TableNode,
      TableRowNode,
      TableCellNode,
    ],
    onError: (error) => {
      console.error('[YjsBootstrap] Headless editor error:', error);
    },
  });

  // Populate the editor with content.
  // Detect XML (legacy pre-#2472 content) vs markdown.
  editor.update(
    () => {
      const trimmed = content.trimStart();
      if (trimmed.startsWith('<') && /<\/?[a-zA-Z][\s\S]*?>/.test(trimmed)) {
        // Legacy XML content — insert as plain text paragraphs since
        // DOMParser is not available in Node.js without jsdom.
        const root = $getRoot();
        const lines = content.split('\n');
        for (const line of lines) {
          const paragraph = $createParagraphNode();
          if (line.length > 0) {
            paragraph.append($createTextNode(line));
          }
          root.append(paragraph);
        }
      } else {
        // Markdown content — convert to proper Lexical nodes
        $convertFromMarkdownString(content, TRANSFORMERS);
      }
    },
    { discrete: true },
  );

  // Create a binding between the editor and the Yjs doc
  const docMap = new Map<string, Y.Doc>();
  docMap.set('root', doc);

  const binding = createBinding(
    editor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no-op provider satisfies runtime needs
    NOOP_PROVIDER as any,
    'root',
    doc,
    docMap,
  );

  // Sync the Lexical state into the Yjs doc.
  // syncLexicalUpdateToYjs requires prev and curr editor states,
  // dirty elements/leaves tracking, and normalized nodes.
  const editorState = editor.getEditorState();
  const emptyState = editor.parseEditorState('{"root":{"children":[],"type":"root","version":1}}');

  // Collect all node keys as dirty so the sync processes everything
  const dirtyElements: Map<string, boolean> = new Map();
  const dirtyLeaves: Set<string> = new Set();
  editorState.read(() => {
    const root = $getRoot();
    dirtyElements.set('root', false);
    for (const child of root.getChildren()) {
      dirtyElements.set(child.getKey(), false);
      if ($isElementNode(child)) {
        for (const leaf of child.getChildren()) {
          dirtyLeaves.add(leaf.getKey());
        }
      } else {
        dirtyLeaves.add(child.getKey());
      }
    }
  });

  syncLexicalUpdateToYjs(
    binding,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no-op provider
    NOOP_PROVIDER as any,
    emptyState,
    editorState,
    dirtyElements,
    dirtyLeaves,
    new Set(),
    new Set(),
  );
}
