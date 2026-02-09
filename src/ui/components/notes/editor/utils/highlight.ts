/**
 * Code syntax highlighting utilities.
 * Part of Epic #338, Issue #757
 *
 * Issue #681: Optimized bundle size by lazy-loading less common languages.
 *
 * Strategy:
 * - Load most common languages (JS, TS, JSON, Bash) upfront for instant highlighting
 * - Lazy-load other languages when first requested
 * - Languages are cached after loading
 */

import hljs from 'highlight.js/lib/core';

// Import core languages that are loaded immediately (most commonly used)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';

// Register core languages immediately
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);

/**
 * Map of language aliases to their module paths for lazy loading.
 * These languages are loaded on-demand when first used.
 */
const LAZY_LANGUAGE_LOADERS: Record<string, () => Promise<{ default: Parameters<typeof hljs.registerLanguage>[1] }>> = {
  python: () => import('highlight.js/lib/languages/python'),
  py: () => import('highlight.js/lib/languages/python'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  sql: () => import('highlight.js/lib/languages/sql'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  yml: () => import('highlight.js/lib/languages/yaml'),
  xml: () => import('highlight.js/lib/languages/xml'),
  html: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  // Additional languages can be added here as needed
  java: () => import('highlight.js/lib/languages/java'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  cs: () => import('highlight.js/lib/languages/csharp'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rb: () => import('highlight.js/lib/languages/ruby'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  scala: () => import('highlight.js/lib/languages/scala'),
  r: () => import('highlight.js/lib/languages/r'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  md: () => import('highlight.js/lib/languages/markdown'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  docker: () => import('highlight.js/lib/languages/dockerfile'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
};

// Track which languages are currently being loaded to avoid duplicate requests
const loadingLanguages = new Set<string>();

/**
 * Lazy load a language for highlight.js.
 * Returns true if language is already available or successfully loaded,
 * false if loading started but not yet complete.
 */
export async function loadLanguage(lang: string): Promise<boolean> {
  const langLower = lang.toLowerCase();

  // Check if already loaded
  if (hljs.getLanguage(langLower)) {
    return true;
  }

  // Check if we have a loader for this language
  const loader = LAZY_LANGUAGE_LOADERS[langLower];
  if (!loader) {
    return false; // Unknown language
  }

  // Check if already loading
  if (loadingLanguages.has(langLower)) {
    return false; // Loading in progress
  }

  // Start loading
  loadingLanguages.add(langLower);
  try {
    const module = await loader();
    // Determine the canonical name for this language
    const canonicalName =
      langLower === 'py'
        ? 'python'
        : langLower === 'yml'
          ? 'yaml'
          : langLower === 'html'
            ? 'xml'
            : langLower === 'cs'
              ? 'csharp'
              : langLower === 'rb'
                ? 'ruby'
                : langLower === 'md'
                  ? 'markdown'
                  : langLower === 'docker'
                    ? 'dockerfile'
                    : langLower;

    hljs.registerLanguage(canonicalName, module.default);

    // Also register the alias if different
    if (langLower !== canonicalName && !hljs.getLanguage(langLower)) {
      hljs.registerLanguage(langLower, module.default);
    }

    return true;
  } catch (error) {
    console.warn(`[LexicalEditor] Failed to load language: ${langLower}`, error);
    return false;
  } finally {
    loadingLanguages.delete(langLower);
  }
}

/**
 * Try to load a language synchronously if available, or start async load.
 * Returns the language name if available, undefined otherwise.
 */
export function getOrLoadLanguage(lang: string): string | undefined {
  const langLower = lang.toLowerCase();

  // Check if already loaded
  if (hljs.getLanguage(langLower)) {
    return langLower;
  }

  // Check if we have a loader and start loading (fire-and-forget)
  if (LAZY_LANGUAGE_LOADERS[langLower]) {
    loadLanguage(langLower).catch(() => {
      // Ignore - already logged in loadLanguage
    });
  }

  return undefined;
}

/**
 * Highlight code using highlight.js.
 * Returns highlighted HTML or escaped plain text if language not supported.
 *
 * Issue #681: Uses lazy loading for non-core languages. If a language
 * isn't loaded yet, returns plain text and triggers a background load.
 * The language will be available on subsequent renders.
 */
export function highlightCode(code: string, language?: string): string {
  const trimmedCode = code.trim();
  const escapedCode = trimmedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (!language) {
    // For auto-detection, only use core languages to avoid expensive checks
    // This returns escaped code if no confident match
    try {
      const result = hljs.highlightAuto(trimmedCode);
      // Only use the result if we're confident (relevance > 5)
      if (result.relevance > 5) {
        return result.value;
      }
      return escapedCode;
    } catch {
      return escapedCode;
    }
  }

  // Try to get or load the language
  const availableLang = getOrLoadLanguage(language);

  if (!availableLang) {
    // Language not loaded yet (will load in background for next time)
    return escapedCode;
  }

  // Try highlighting with the available language
  try {
    const result = hljs.highlight(trimmedCode, { language: availableLang });
    return result.value;
  } catch {
    // Highlighting failed, return escaped plain text
    return escapedCode;
  }
}
