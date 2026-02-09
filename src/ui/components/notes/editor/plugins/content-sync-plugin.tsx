/**
 * Plugin to sync content changes.
 * Part of Epic #338, Issues #757, #775
 *
 * Note: Save shortcut (Ctrl+S) is no longer handled here since we use autosave.
 */

import React, { useCallback } from 'react';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import type { EditorState } from 'lexical';
import type { ContentSyncPluginProps } from '../types';

export function ContentSyncPlugin({ onChange }: ContentSyncPluginProps): React.JSX.Element {
  // Export to markdown on change
  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const markdown = $convertToMarkdownString(TRANSFORMERS);
        onChange?.(markdown);
      });
    },
    [onChange],
  );

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}
