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

  /** Export / download strings (Epic #2475, Issue #2480). */
  export: {
    /** Button / trigger */
    button: {
      tooltip: 'Download',
      label: 'Download',
    },
    /** Format options */
    format: {
      pdf: {
        label: 'PDF',
        description: 'Best for sharing and printing',
      },
      docx: {
        label: 'Word Document (.docx)',
        description: 'Edit in Microsoft Word or Google Docs',
      },
      odf: {
        label: 'OpenDocument (.odf)',
        description: 'Open with LibreOffice or compatible software',
      },
    },
    /** Progress and status messages */
    progress: {
      preparing: 'Preparing your download...',
      preparingNotebook: (count: number) => `Preparing notebook (${count} note${count !== 1 ? 's' : ''})...`,
      ready: 'Download ready',
      failed: 'Export failed — please try again',
      failedNoRetry: 'Export failed',
      expired: 'Export link has expired',
    },
    /** Actions */
    actions: {
      retry: 'Retry',
      dismiss: 'Dismiss',
      downloadAgain: 'Download again',
    },
    /** Accessibility labels */
    aria: {
      exportButton: (noteName: string) => `Download ${noteName}`,
      exportButtonInProgress: 'Export in progress',
      exportProgress: (format: string) => `Preparing ${format} export`,
      dismissProgress: 'Dismiss export progress',
      formatPicker: 'Choose download format',
    },
  },
} as const;
