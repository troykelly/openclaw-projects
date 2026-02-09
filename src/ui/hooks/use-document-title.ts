/**
 * Hook for updating the document title reactively.
 *
 * Sets `document.title` on mount and whenever the provided title
 * string changes. Restores the previous title on unmount so that
 * nested title updates compose correctly.
 *
 * @see Issue #480 - WCAG 2.1 AA compliance
 */
import { useEffect, useRef } from 'react';

/**
 * Set the browser document title. The previous title is restored
 * when the component that uses this hook unmounts.
 *
 * @param title - The desired page title (the suffix " - OpenClaw Projects" is appended automatically).
 * @param options.restoreOnUnmount - Whether to restore the previous title on unmount. Defaults to true.
 */
export function useDocumentTitle(title: string, options: { restoreOnUnmount?: boolean } = {}): void {
  const { restoreOnUnmount = true } = options;
  const previousTitle = useRef(document.title);

  useEffect(() => {
    const fullTitle = title ? `${title} - OpenClaw Projects` : 'OpenClaw Projects';
    document.title = fullTitle;

    return () => {
      if (restoreOnUnmount) {
        document.title = previousTitle.current;
      }
    };
  }, [title, restoreOnUnmount]);
}
