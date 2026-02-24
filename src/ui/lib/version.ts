/**
 * Application version string, injected at build time by Vite's `define` config.
 * Falls back to 'dev' when running outside the Vite pipeline (e.g. tests).
 */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
