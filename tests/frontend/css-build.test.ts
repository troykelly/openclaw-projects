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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('Tailwind CSS Build', () => {
  let cssContent: string;

  beforeAll(() => {
    // Find the main CSS file in the build output.
    // The main CSS file starts with "index-" and contains the Tailwind utilities.
    // Other CSS files (like NotesPage-*.css) may contain component-specific styles.
    const assetsDir = join(__dirname, '../../src/api/static/app/assets');
    const files = readdirSync(assetsDir);
    const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'))
      || files.find(f => f.endsWith('.css'));

    if (!cssFile) {
      throw new Error('No CSS file found in build output. Run `pnpm app:build` first.');
    }

    cssContent = readFileSync(join(assetsDir, cssFile), 'utf-8');
  });

  it('should include flexbox utilities', () => {
    // These are used extensively in the layout components
    expect(cssContent).toContain('.flex');
    expect(cssContent).toContain('.flex-1');
    expect(cssContent).toContain('.flex-col');
  });

  it('should include display utilities', () => {
    expect(cssContent).toContain('.hidden');
    expect(cssContent).toContain('.block');
  });

  it('should include spacing utilities', () => {
    expect(cssContent).toContain('.p-4');
    expect(cssContent).toContain('.gap-');
  });

  it('should include responsive prefixes', () => {
    // md:block is used for sidebar visibility
    expect(cssContent).toContain('md\\:block');
  });

  it('should include height utilities', () => {
    // h-screen is used for the app shell
    expect(cssContent).toContain('.h-screen');
    expect(cssContent).toContain('.h-14');
  });

  it('should include background color utilities', () => {
    expect(cssContent).toContain('.bg-background');
    expect(cssContent).toContain('.bg-surface');
  });

  it('should include text utilities', () => {
    expect(cssContent).toContain('.text-');
    expect(cssContent).toContain('.font-');
  });

  it('should include border utilities', () => {
    expect(cssContent).toContain('.border');
    expect(cssContent).toContain('.rounded');
  });

  it('should include overflow utilities', () => {
    expect(cssContent).toContain('.overflow-hidden');
    expect(cssContent).toContain('.overflow-y-auto');
  });

  it('should have reasonable size (>50KB indicates utility classes present)', () => {
    // Without utility classes, the CSS is ~7KB
    // With utility classes, it's ~100KB+
    expect(cssContent.length).toBeGreaterThan(50000);
  });
});

describe('app.css @source directives', () => {
  let appCssContent: string;

  beforeAll(() => {
    appCssContent = readFileSync(
      join(__dirname, '../../src/ui/app.css'),
      'utf-8'
    );
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
