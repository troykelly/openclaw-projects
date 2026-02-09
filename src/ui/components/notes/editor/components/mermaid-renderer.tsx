/**
 * Mermaid diagram renderer component.
 * Part of Epic #338, Issue #757
 *
 * Mermaid is lazy-loaded (~1MB) only when diagrams are detected (#685).
 * Uses Mermaid's built-in theme support for dark mode (#686).
 *
 * Security: Mermaid is configured with securityLevel: 'strict' which sanitizes
 * the SVG output. Error messages are escaped before display.
 */

import { useEffect } from 'react';
import type mermaidType from 'mermaid';
import type { MermaidRendererProps } from '../types';

/**
 * Lazy-loaded Mermaid instance with theme support.
 * Mermaid.js is ~1MB and includes D3.js and many sub-dependencies.
 * Most users don't use diagrams, so we lazy load it only when needed (#685).
 * The promise is cached so subsequent calls return the same instance.
 *
 * Theme support (#686): Uses Mermaid's built-in 'dark' theme for dark mode
 * instead of CSS filter inversion, providing better color accuracy.
 */
let mermaidPromise: Promise<typeof mermaidType> | null = null;
let lastInitializedTheme: 'dark' | 'default' | null = null;

async function getMermaid(isDark: boolean = false): Promise<typeof mermaidType> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  const theme = isDark ? 'dark' : 'default';
  // Re-initialize if theme changed or not yet initialized (#686)
  if (lastInitializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict', // Prevent XSS
      fontFamily: 'inherit',
    });
    lastInitializedTheme = theme;
  }
  return mermaid;
}

/**
 * Component to render mermaid diagrams after the preview HTML is mounted.
 * Scans for elements with data-mermaid attribute and renders the diagrams.
 */
export function MermaidRenderer({ containerRef, isDark = false }: MermaidRendererProps): null {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mermaidElements = container.querySelectorAll('[data-mermaid]');
    if (mermaidElements.length === 0) return;

    // Track if component is still mounted for async cleanup
    let isMounted = true;

    // Render each mermaid diagram
    const renderDiagrams = async () => {
      // Lazy load mermaid with current theme only when diagrams are present (#685, #686)
      const mermaid = await getMermaid(isDark);

      mermaidElements.forEach(async (element, index) => {
        if (!isMounted) return;

        const code = element.getAttribute('data-mermaid');
        if (!code) return;

        // Decode HTML entities
        const decodedCode = code
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');

        try {
          const id = `mermaid-diagram-${Date.now()}-${index}`;
          // mermaid.render returns sanitized SVG when securityLevel: 'strict' is set
          const { svg } = await mermaid.render(id, decodedCode);

          if (!isMounted) return;

          // Clear placeholder and insert SVG
          while (element.firstChild) {
            element.removeChild(element.firstChild);
          }
          // Create a container for the SVG and set its content
          // The SVG from mermaid.render is already sanitized with securityLevel: 'strict'
          const svgContainer = document.createElement('div');
          svgContainer.className = 'mermaid-svg-container';
          // Using DOMParser to safely parse the SVG
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
          const svgElement = svgDoc.documentElement;
          if (svgElement && svgElement.nodeName === 'svg') {
            svgContainer.appendChild(document.importNode(svgElement, true));
          }
          element.appendChild(svgContainer);
          element.classList.add('mermaid-rendered');
        } catch (error) {
          if (!isMounted) return;

          // Show error message in the placeholder (escaped for safety)
          // Log in development only to avoid information leakage in production (#676)
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.error('[MermaidRenderer]', error);
          }
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Clear placeholder
          while (element.firstChild) {
            element.removeChild(element.firstChild);
          }

          // Create error display using DOM methods (not innerHTML)
          const errorDiv = document.createElement('div');
          errorDiv.className = 'bg-destructive/10 text-destructive p-4 rounded-md text-sm';

          const strongEl = document.createElement('strong');
          strongEl.textContent = 'Mermaid diagram error:';
          errorDiv.appendChild(strongEl);

          const preEl = document.createElement('pre');
          preEl.className = 'mt-2 text-xs overflow-auto';
          preEl.textContent = errorMessage;
          errorDiv.appendChild(preEl);

          element.appendChild(errorDiv);
          element.classList.add('mermaid-error');
        }
      });
    };

    renderDiagrams();

    return () => {
      isMounted = false;
    };
  }, [containerRef, isDark]);

  return null;
}
