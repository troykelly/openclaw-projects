/**
 * UI state store using Zustand.
 *
 * Manages transient UI state that does not need to persist across sessions:
 * - Sidebar collapse
 * - Active modals
 * - Command palette open/closed
 * - Resolved theme (mirrors existing useDarkMode hook)
 */
import { create } from 'zustand';

/** Identifiers for modals that can be open at a time. */
export type ModalId = 'quick-add' | 'create-work-item' | 'delete-confirm' | 'move-to' | 'memory-editor' | 'contact-form' | 'contact-detail' | null;

export interface UiState {
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Currently open modal (null = none). */
  activeModal: ModalId;
  /** Whether the command palette is open. */
  commandPaletteOpen: boolean;
  /** Resolved theme for quick access. */
  theme: 'light' | 'dark';
}

export interface UiActions {
  /** Toggle sidebar collapsed state. */
  toggleSidebar: () => void;
  /** Set sidebar collapsed state explicitly. */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Open a specific modal by id. */
  openModal: (id: NonNullable<ModalId>) => void;
  /** Close the currently open modal. */
  closeModal: () => void;
  /** Set command palette open state. */
  setCommandPaletteOpen: (open: boolean) => void;
  /** Toggle command palette. */
  toggleCommandPalette: () => void;
  /** Set the resolved theme. */
  setTheme: (theme: 'light' | 'dark') => void;
}

export type UiStore = UiState & UiActions;

/**
 * Zustand store for transient UI state.
 *
 * Usage:
 * ```ts
 * const sidebarCollapsed = useUiStore(s => s.sidebarCollapsed);
 * const toggleSidebar = useUiStore(s => s.toggleSidebar);
 * ```
 */
export const useUiStore = create<UiStore>((set) => ({
  // State
  sidebarCollapsed: false,
  activeModal: null,
  commandPaletteOpen: false,
  theme: 'light',

  // Actions
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setTheme: (theme) => set({ theme }),
}));
