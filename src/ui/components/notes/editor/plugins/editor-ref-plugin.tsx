/**
 * Plugin to expose the Lexical editor instance via a ref.
 * Used for content extraction during mode switching with Yjs active (Issue #2343).
 */
import { useEffect, type MutableRefObject } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { LexicalEditor } from 'lexical';

export function EditorRefPlugin({ editorRef }: { editorRef: MutableRefObject<LexicalEditor | null> }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  return null;
}
