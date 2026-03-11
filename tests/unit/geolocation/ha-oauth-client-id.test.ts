/**
 * Tests verifying the HA IndieAuth redirect_uri discovery link tag is injected
 * into the landing page when OAUTH_REDIRECT_URI is configured.
 *
 * Issue #2383: HA's IndieAuth validates that client_id and redirect_uri share
 * the same host. When they differ (e.g. execdesk.ai vs api.execdesk.ai), HA
 * fetches the client_id URL and looks for <link rel="redirect_uri"> tags in the
 * first 10 KB of the page. We inject this tag into the root landing page.
 *
 * Ref: https://developers.home-assistant.io/docs/auth_api/
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read server.ts source to verify the injection logic is present
const serverSrc = readFileSync(resolve('src/api/server.ts'), 'utf8');

describe('HA IndieAuth redirect_uri discovery — landing page injection (#2383)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('renderLandingPage reads OAUTH_REDIRECT_URI from environment', () => {
    // Verify the source contains the env var read
    expect(serverSrc).toContain("process.env.OAUTH_REDIRECT_URI?.trim()");
  });

  it('renderLandingPage injects <link rel="redirect_uri"> when OAUTH_REDIRECT_URI is set', () => {
    // Verify the template string includes the conditional link tag injection
    expect(serverSrc).toContain('<link rel="redirect_uri" href="${oauthRedirectUri}" />');
    expect(serverSrc).toContain('indieAuthLinkTag');
  });

  it('link tag is placed inside <head> in the template', () => {
    // Extract the renderLandingPage function body
    const fnStart = serverSrc.indexOf('function renderLandingPage(');
    const fnEnd = serverSrc.indexOf('\n  }', fnStart) + 4;
    const fnBody = serverSrc.slice(fnStart, fnEnd);

    // ${indieAuthLinkTag} must appear before </head>
    const linkTagPos = fnBody.indexOf('${indieAuthLinkTag}');
    const headClosePos = fnBody.indexOf('</head>');
    expect(linkTagPos).toBeGreaterThan(-1);
    expect(headClosePos).toBeGreaterThan(-1);
    expect(linkTagPos).toBeLessThan(headClosePos);
  });

  it('no link tag is injected when OAUTH_REDIRECT_URI is absent', () => {
    // The conditional guard ensures an empty string when env var is unset
    expect(serverSrc).toContain(
      "const indieAuthLinkTag = oauthRedirectUri\n      ? `\\n  <link rel=\"redirect_uri\" href=\"${oauthRedirectUri}\" />`\n      : '';"
    );
  });

  it('clientId in authorize handler still uses PUBLIC_BASE_URL (not deriveApiUrl)', () => {
    // Option C fix: clientId stays as PUBLIC_BASE_URL — the link tag handles discovery.
    // Ensure we did NOT apply Option A (which would change clientId to use deriveApiUrl).
    const authorizeBlock = serverSrc.match(
      /Generate state and build HA authorize URL[\s\S]{0,400}buildAuthorizationUrl/
    );
    expect(authorizeBlock).not.toBeNull();
    // clientId must derive from rawBase directly, not from deriveApiUrl
    expect(authorizeBlock![0]).toMatch(/clientId\s*=\s*rawBase\.replace/);
    expect(authorizeBlock![0]).not.toMatch(/clientId\s*=\s*deriveApiUrl\(rawBase\)\.replace/);
  });

  it('clientId in callback handler still uses PUBLIC_BASE_URL (not deriveApiUrl)', () => {
    const callbackBlock = serverSrc.match(
      /HA OAuth callback[\s\S]{0,600}Exchange code for tokens/
    );
    expect(callbackBlock).not.toBeNull();
    expect(callbackBlock![0]).toMatch(/clientId\s*=\s*rawBase\.replace/);
    expect(callbackBlock![0]).not.toMatch(/clientId\s*=\s*deriveApiUrl\(rawBase\)\.replace/);
  });
});
