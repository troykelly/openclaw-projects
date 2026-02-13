// Only load gateway setup in Node (not jsdom) — gateway imports use
// relative paths that fail under Vite's /@fs/ resolver in jsdom.
if (typeof window === 'undefined') {
  await import('../.local/openclaw-gateway/test/setup.ts');
}
