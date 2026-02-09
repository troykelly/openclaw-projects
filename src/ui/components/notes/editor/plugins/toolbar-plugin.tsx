/**
 * Toolbar plugin providing formatting controls.
 * Part of Epic #338, Issue #757
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $createCodeNode } from '@lexical/code';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  FileCode,
  Table,
} from 'lucide-react';
import { ToolbarButton } from '../components/toolbar-button';
import { ToolbarSeparator } from '../components/toolbar-separator';
import { LinkDialog } from '../dialogs/link-dialog';
import { TableDialog } from '../dialogs/table-dialog';
import type { ToolbarPluginProps } from '../types';

export function ToolbarPlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);

  // Dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);

  // Update toolbar state based on selection
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setIsBold(selection.hasFormat('bold'));
          setIsItalic(selection.hasFormat('italic'));
          setIsUnderline(selection.hasFormat('underline'));
          setIsStrikethrough(selection.hasFormat('strikethrough'));
        }
      });
    });
  }, [editor]);

  const formatBold = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
  const formatItalic = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
  const formatUnderline = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
  const formatStrikethrough = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');

  const formatHeading = (level: 'h1' | 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(level));
      }
    });
  };

  const formatBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  };

  const formatNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  const handleLinkSubmit = useCallback(
    (url: string) => {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    },
    [editor],
  );

  const insertCodeBlock = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createCodeNode('javascript'));
      }
    });
  };

  const handleTableSubmit = useCallback(
    (rows: number, columns: number) => {
      editor.dispatchCommand(INSERT_TABLE_COMMAND, {
        rows: rows.toString(),
        columns: columns.toString(),
        includeHeaders: true,
      });
    },
    [editor],
  );

  const undo = () => editor.dispatchCommand(UNDO_COMMAND, undefined);
  const redo = () => editor.dispatchCommand(REDO_COMMAND, undefined);

  return (
    <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
      <ToolbarButton icon={<Undo className="h-4 w-4" />} label="Undo (Ctrl+Z)" onClick={undo} />
      <ToolbarButton icon={<Redo className="h-4 w-4" />} label="Redo (Ctrl+Y)" onClick={redo} />

      <ToolbarSeparator />

      <ToolbarButton icon={<Bold className="h-4 w-4" />} label="Bold (Ctrl+B)" onClick={formatBold} active={isBold} />
      <ToolbarButton icon={<Italic className="h-4 w-4" />} label="Italic (Ctrl+I)" onClick={formatItalic} active={isItalic} />
      <ToolbarButton icon={<Underline className="h-4 w-4" />} label="Underline (Ctrl+U)" onClick={formatUnderline} active={isUnderline} />
      <ToolbarButton icon={<Strikethrough className="h-4 w-4" />} label="Strikethrough" onClick={formatStrikethrough} active={isStrikethrough} />

      <ToolbarSeparator />

      <ToolbarButton icon={<Heading1 className="h-4 w-4" />} label="Heading 1" onClick={() => formatHeading('h1')} />
      <ToolbarButton icon={<Heading2 className="h-4 w-4" />} label="Heading 2" onClick={() => formatHeading('h2')} />
      <ToolbarButton icon={<Heading3 className="h-4 w-4" />} label="Heading 3" onClick={() => formatHeading('h3')} />

      <ToolbarSeparator />

      <ToolbarButton icon={<List className="h-4 w-4" />} label="Bullet List" onClick={formatBulletList} />
      <ToolbarButton icon={<ListOrdered className="h-4 w-4" />} label="Numbered List" onClick={formatNumberedList} />
      <ToolbarButton icon={<Quote className="h-4 w-4" />} label="Quote" onClick={formatQuote} />
      <ToolbarButton icon={<Link className="h-4 w-4" />} label="Insert Link" onClick={() => setLinkDialogOpen(true)} />
      <ToolbarButton icon={<FileCode className="h-4 w-4" />} label="Code Block" onClick={insertCodeBlock} />
      <ToolbarButton icon={<Table className="h-4 w-4" />} label="Insert Table" onClick={() => setTableDialogOpen(true)} />

      {/* Dialogs */}
      <LinkDialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen} onSubmit={handleLinkSubmit} />
      <TableDialog open={tableDialogOpen} onOpenChange={setTableDialogOpen} onSubmit={handleTableSubmit} />
    </div>
  );
}
