/**
 * Centralised namespace UI strings (Issue #2357).
 *
 * No i18n framework is installed yet — these constants organise all
 * user-facing strings so future extraction is straightforward.
 * Components MUST reference these constants instead of inline strings.
 */
export const NAMESPACE_STRINGS = {
  /** Namespace selector / indicator. */
  selector: {
    label: 'Namespace',
    multiLabel: 'Namespaces',
    placeholder: 'Select namespace...',
    switchAriaLabel: 'Switch namespace',
    multiSelectAriaLabel: 'Select active namespaces',
    multipleSelected: (count: number) => `${count} namespaces`,
  },

  /** Namespace badge on entities. */
  badge: {
    ariaLabel: (namespace: string) => `Namespace: ${namespace}`,
  },

  /** Namespace picker in create forms. */
  picker: {
    label: 'Namespace',
    ariaLabel: 'Select namespace',
  },

  /** Transition overlay during namespace switch. */
  transition: {
    switching: (namespace: string) => `Switching to ${namespace}...`,
  },

  /** Empty states in namespace-filtered views. */
  empty: {
    noItems: (namespace: string) => `No items in "${namespace}"`,
    noItemsMulti: 'No items in selected namespaces',
  },

  /** Error messages. */
  errors: {
    loadFailed: 'Failed to load namespaces',
    noAccess: 'No namespace access. Contact your administrator.',
  },
} as const;
