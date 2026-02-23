/**
 * Bootstrap all geolocation provider plugins into the registry.
 * Called once at server startup before routes are registered.
 * Issue #1607, Epic #1440.
 */
import { registerHaProvider } from './providers/home-assistant.ts';
import { registerMqttProvider } from './providers/mqtt-provider.ts';
import { registerWebhookProvider } from './providers/webhook-provider.ts';
import { getRegisteredTypes } from './registry.ts';

export function bootstrapGeoProviders(): void {
  const registered = new Set(getRegisteredTypes());
  if (!registered.has('home_assistant')) registerHaProvider();
  if (!registered.has('mqtt')) registerMqttProvider();
  if (!registered.has('webhook')) registerWebhookProvider();
}
