import { useCallback } from 'react';
import { useHotkeys, useSequentialHotkeys } from '@/ui/hooks/use-hotkeys';

interface KeyboardShortcutsHandlerProps {
  onNavigate?: (section: string) => void;
  onSearch?: () => void;
  onNewItem?: () => void;
  onNewItemFullForm?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onChangeStatus?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSelect?: () => void;
  onBack?: () => void;
  onOpenSelected?: () => void;
  onToggleChat?: () => void;
}

export function KeyboardShortcutsHandler({
  onNavigate,
  onSearch,
  onNewItem,
  onNewItemFullForm,
  onEdit,
  onDelete,
  onChangeStatus,
  onMoveUp,
  onMoveDown,
  onSelect,
  onBack,
  onOpenSelected,
  onToggleChat,
}: KeyboardShortcutsHandlerProps) {
  // Navigation shortcuts (G then X)
  const goToActivity = useCallback(() => onNavigate?.('activity'), [onNavigate]);
  const goToProjects = useCallback(() => onNavigate?.('projects'), [onNavigate]);
  const goToTimeline = useCallback(() => onNavigate?.('timeline'), [onNavigate]);
  const goToContacts = useCallback(() => onNavigate?.('people'), [onNavigate]);
  const goToSettings = useCallback(() => onNavigate?.('settings'), [onNavigate]);
  const goToMessages = useCallback(() => onToggleChat?.(), [onToggleChat]);

  useSequentialHotkeys(['g', 'a'], goToActivity);
  useSequentialHotkeys(['g', 'p'], goToProjects);
  useSequentialHotkeys(['g', 't'], goToTimeline);
  useSequentialHotkeys(['g', 'c'], goToContacts);
  useSequentialHotkeys(['g', 's'], goToSettings);
  useSequentialHotkeys(['g', 'm'], goToMessages);

  // Global shortcuts
  useHotkeys('meta+k', () => onSearch?.());
  useHotkeys('ctrl+k', () => onSearch?.());

  // List navigation
  useHotkeys('j', () => onMoveDown?.());
  useHotkeys('k', () => onMoveUp?.());
  useHotkeys('enter', () => onOpenSelected?.());
  useHotkeys('backspace', () => onBack?.());

  // Actions
  useHotkeys('n', () => onNewItem?.());
  useHotkeys('shift+n', () => onNewItemFullForm?.());
  useHotkeys('e', () => onEdit?.());
  useHotkeys('d', () => onDelete?.());
  useHotkeys('s', () => onChangeStatus?.());
  useHotkeys(' ', () => onSelect?.()); // Space for toggle selection

  return null;
}
