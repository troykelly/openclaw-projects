// Tests to verify the Tailwind CSS build includes essential utility classes.
//
// This test exists because Tailwind v4's automatic content detection can fail
// when Vite's root directory doesn't contain all the source files that use
// Tailwind classes. The @source directive in app.css must point to all TSX files.
//
// If this test fails, ensure src/ui/app.css has proper @source directives:
//   @source "../ * * / *.tsx";  (without spaces)
//   @source "../ * * / *.ts";   (without spaces)

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join(__dirname, '../../src/api/static/app/assets');
const hasBuiltAssets = existsSync(ASSETS_DIR);

describe('Tailwind CSS Build', () => {
  let cssContent: string;

  beforeAll(() => {
    if (!hasBuiltAssets) {
      console.log('Skipping CSS content tests - build output not found. Run `pnpm app:build` first.');
      return;
    }

    // Find the main CSS file in the build output.
    // The main CSS file starts with "index-" and contains the Tailwind utilities.
    // Other CSS files (like NotesPage-*.css) may contain component-specific styles.
    const files = readdirSync(ASSETS_DIR);
    const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css')) || files.find((f) => f.endsWith('.css'));

    if (!cssFile) {
      throw new Error('No CSS file found in build output. Run `pnpm app:build` first.');
    }

    cssContent = readFileSync(join(ASSETS_DIR, cssFile), 'utf-8');
  });

  it.skipIf(!hasBuiltAssets)('should include flexbox utilities', () => {
    // These are used extensively in the layout components
    expect(cssContent).toContain('.flex');
    expect(cssContent).toContain('.flex-1');
    expect(cssContent).toContain('.flex-col');
  });

  it.skipIf(!hasBuiltAssets)('should include display utilities', () => {
    expect(cssContent).toContain('.hidden');
    expect(cssContent).toContain('.block');
  });

  it.skipIf(!hasBuiltAssets)('should include spacing utilities', () => {
    expect(cssContent).toContain('.p-4');
    expect(cssContent).toContain('.gap-');
  });

  it.skipIf(!hasBuiltAssets)('should include responsive prefixes', () => {
    // md:block is used for sidebar visibility
    expect(cssContent).toContain('md\\:block');
  });

  it.skipIf(!hasBuiltAssets)('should include height utilities', () => {
    // h-screen is used for the app shell
    expect(cssContent).toContain('.h-screen');
    expect(cssContent).toContain('.h-14');
  });

  it.skipIf(!hasBuiltAssets)('should include background color utilities', () => {
    expect(cssContent).toContain('.bg-background');
    expect(cssContent).toContain('.bg-surface');
  });

  it.skipIf(!hasBuiltAssets)('should include text utilities', () => {
    expect(cssContent).toContain('.text-');
    expect(cssContent).toContain('.font-');
  });

  it.skipIf(!hasBuiltAssets)('should include border utilities', () => {
    expect(cssContent).toContain('.border');
    expect(cssContent).toContain('.rounded');
  });

  it.skipIf(!hasBuiltAssets)('should include overflow utilities', () => {
    expect(cssContent).toContain('.overflow-hidden');
    expect(cssContent).toContain('.overflow-y-auto');
  });

  it.skipIf(!hasBuiltAssets)('should have reasonable size (>50KB indicates utility classes present)', () => {
    // Without utility classes, the CSS is ~7KB
    // With utility classes, it's ~100KB+
    expect(cssContent.length).toBeGreaterThan(50000);
  });
});

describe('app.css @source directives', () => {
  let appCssContent: string;

  beforeAll(() => {
    appCssContent = readFileSync(join(__dirname, '../../src/ui/app.css'), 'utf-8');
  });

  it('should have @source directive for TSX files', () => {
    expect(appCssContent).toContain('@source');
    expect(appCssContent).toMatch(/@source\s+["'].*\.tsx["']/);
  });

  it('should have @source directive pointing to parent directories', () => {
    // The Vite root is src/ui/app, but components are in src/ui/components
    // So @source needs to go up: "../**/*.tsx"
    expect(appCssContent).toMatch(/@source\s+["']\.\.\/.*\.tsx["']/);
  });
});
