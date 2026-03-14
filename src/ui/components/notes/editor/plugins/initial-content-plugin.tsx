/**
 * Plugin to initialize editor with markdown or XML content.
 * Part of Epic #338, Issue #757
 *
 * Fixed in #786:
 * - Runs only once on mount (useRef instead of useState to avoid re-render triggers)
 * - Handles empty content correctly (marks as initialized to prevent cursor bugs)
 *
 * Fixed in #2562:
 * - Detects XML content (legacy Y.XmlText.toString() output) and parses via DOM
 * - Falls back to markdown conversion for non-XML content
 */

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $insertNodes } from 'lexical';
import type { InitialContentPluginProps } from '../types';

export function InitialContentPlugin({ initialContent }: InitialContentPluginProps): null {
  const [editor] = useLexicalComposerContext();
  // Use ref to track initialization - avoids re-render and only runs once per mount
  const initializedRef = useRef(false);

  useEffect(() => {
    // Only initialize once on mount
    if (initializedRef.current) return;
    initializedRef.current = true;

    // If there's content to load, initialize the editor with it
    if (initialContent) {
      editor.update(() => {
        const trimmed = initialContent.trimStart();
        if (trimmed.startsWith('<') && /<\/?[a-zA-Z][\s\S]*?>/.test(trimmed)) {
          // Parse as HTML/XML — handles legacy Y.XmlText.toString() output (#2562)
          const parser = new DOMParser();
          const dom = parser.parseFromString(`<body>${initialContent}</body>`, 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          const root = $getRoot();
          root.clear();
          root.selectEnd();
          $insertNodes(nodes);
        } else {
          $convertFromMarkdownString(initialContent, TRANSFORMERS);
        }
      });
    }
    // For empty content, we do nothing - the editor starts empty by default
  }, [editor, initialContent]);

  return null;
}
