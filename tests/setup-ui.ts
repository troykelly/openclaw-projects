import '@testing-library/jest-dom/vitest';

// Mock localStorage for jsdom environment
// Note: jsdom provides localStorage but it may not work properly in all cases
if (typeof window !== 'undefined') {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem(key: string): string | null {
        return store[key] ?? null;
      },
      setItem(key: string, value: string): void {
        store[key] = String(value);
      },
      removeItem(key: string): void {
        delete store[key];
      },
      clear(): void {
        store = {};
      },
      get length(): number {
        return Object.keys(store).length;
      },
      key(index: number): string | null {
        return Object.keys(store)[index] ?? null;
      },
    };
  })();

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

// Only apply DOM mocks when running in jsdom environment
if (typeof Element !== 'undefined') {
  // Mock scrollIntoView for Radix UI components
  Element.prototype.scrollIntoView = () => {};

  // Mock hasPointerCapture for Radix UI
  Element.prototype.hasPointerCapture = () => false;
}

// Mock ResizeObserver (needed for Radix UI in jsdom)
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock matchMedia for reduced motion detection
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
}
