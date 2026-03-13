/**
 * PDF generator using puppeteer-core + system Chromium.
 * Part of Epic #2475, Issue #2477.
 *
 * Sanitises HTML input to prevent stored-XSS-to-PDF exploitation.
 */

import puppeteer from 'puppeteer-core';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import type { PdfGeneratorInput } from '../types.ts';

/** Known Chromium binary locations */
const CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

/** Print-friendly CSS applied to all PDF exports */
const PRINT_CSS = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
  }
  h1, h2, h3, h4 { page-break-after: avoid; margin-top: 1.5em; }
  pre, code {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 10pt;
    background: #f5f5f5;
    padding: 0.2em 0.4em;
    border-radius: 3px;
  }
  pre {
    padding: 1em;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  blockquote {
    border-left: 3px solid #ccc;
    margin-left: 0;
    padding-left: 1em;
    color: #555;
  }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f5f5f5; }
  img { max-width: 100%; height: auto; }
  a { color: #0066cc; text-decoration: none; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
`;

/**
 * Resolves the path to the system Chromium binary.
 * Checks PUPPETEER_EXECUTABLE_PATH env var first, then known locations.
 */
export function resolveChromiumPath(): string {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;

  // In test/dev, we may not have Chromium installed
  for (const p of CHROMIUM_PATHS) {
    try {
      const fs = require('fs');
      if (fs.existsSync(p)) return p;
    } catch {
      // continue
    }
  }

  throw new Error(
    'Chromium binary not found. Set PUPPETEER_EXECUTABLE_PATH or install chromium. ' +
    `Checked: ${CHROMIUM_PATHS.join(', ')}`,
  );
}

/**
 * Sanitises HTML to prevent XSS in PDF rendering.
 * Strips script tags, event handlers, and other dangerous content.
 */
export function sanitiseHtml(html: string): string {
  const window = new JSDOM('').window;
  const purify = DOMPurify(window as unknown as Window);
  return purify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
}

/**
 * Generates a PDF buffer from HTML content.
 *
 * @param input - HTML string and optional PDF options
 * @returns PDF binary as Buffer
 * @throws Error if Chromium is not available
 */
export async function generatePdf(input: PdfGeneratorInput): Promise<Buffer> {
  const executablePath = resolveChromiumPath();
  const cleanHtml = sanitiseHtml(input.html);

  const pageSize = input.options?.page_size ?? 'A4';
  const margin = input.options?.margin ?? '20mm';

  const fullHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${PRINT_CSS}</style></head>
<body>${cleanHtml}</body>
</html>`;

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: pageSize,
      margin: { top: margin, right: margin, bottom: margin, left: margin },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
