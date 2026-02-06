/**
 * Plugin to initialize editor with markdown content.
 * Part of Epic #338, Issue #757
 *
 * Fixed in #786:
 * - Runs only once on mount (useRef instead of useState to avoid re-render triggers)
 * - Handles empty content correctly (marks as initialized to prevent cursor bugs)
 */

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import type { InitialContentPluginProps } from '../types';

export function InitialContentPlugin({
  initialContent,
}: InitialContentPluginProps): null {
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
        $convertFromMarkdownString(initialContent, TRANSFORMERS);
      });
    }
    // For empty content, we do nothing - the editor starts empty by default
  }, [editor, initialContent]);

  return null;
}
