/**
 * Startup banner for plugin registration.
 *
 * Logs version, agent identity, capabilities, and registration summary
 * when the plugin is loaded by the OpenClaw gateway.
 *
 * Agent IDs and namespace names are operational identifiers, NOT sensitive
 * data — they are intentionally logged for debugging.
 */

import { createRequire } from 'node:module';
import type { Logger } from './logger.js';

const require = createRequire(import.meta.url);

/** Read version from package.json at runtime. */
function getVersion(): string {
  try {
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Configuration subset needed for the startup banner. */
export interface StartupBannerConfig {
  agentId?: string;
  namespace?: { default?: string; recall?: string[] };
  autoRecall?: boolean;
  autoCapture?: boolean;
  twilioAccountSid?: string;
  postmarkToken?: string;
}

/** Registration counts passed from the registration function. */
export interface RegistrationSummary {
  toolCount: number;
  hookCount: number;
  cliCount: number;
}

/**
 * Emits a structured startup banner via the provided logger.
 *
 * Logs exactly 4 lines:
 * 1. Plugin version
 * 2. Agent ID, namespace, recall namespaces
 * 3. Capability flags
 * 4. Registration counts
 */
export function emitStartupBanner(
  logger: Logger,
  config: StartupBannerConfig,
  summary: RegistrationSummary,
): void {
  const version = getVersion();

  const agentId = config.agentId ?? 'unknown';
  const defaultNs = config.namespace?.default ?? 'default';
  const recallNs = config.namespace?.recall ?? [defaultNs];

  const twilio = config.twilioAccountSid ? 'configured' : 'not configured';
  const postmark = config.postmarkToken ? 'configured' : 'not configured';

  logger.info(`Plugin v${version} starting`);
  logger.info(`Agent: ${agentId} | Namespace: ${defaultNs} | Recall: [${recallNs.join(', ')}]`);
  logger.info(`Capabilities: autoRecall=${config.autoRecall ?? false} autoCapture=${config.autoCapture ?? false} twilio=${twilio} postmark=${postmark}`);
  logger.info(`Tools registered: ${summary.toolCount} | Hooks: ${summary.hookCount} | CLI commands: ${summary.cliCount}`);
}
