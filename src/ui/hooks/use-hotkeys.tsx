import * as React from 'react';
import { useEffect, useCallback, useRef, createContext, useContext, useState } from 'react';

type HotkeyCallback = (event: KeyboardEvent) => void;

interface HotkeysContextValue {
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const HotkeysContext = createContext<HotkeysContextValue | null>(null);

export function HotkeysProvider({ children }: { children: React.ReactNode }) {
  const [isEnabled, setEnabled] = useState(true);

  return (
    <HotkeysContext.Provider value={{ isEnabled, setEnabled }}>
      {children}
    </HotkeysContext.Provider>
  );
}

export function useHotkeysContext() {
  const context = useContext(HotkeysContext);
  if (!context) {
    // Return default values if not within provider
    return { isEnabled: true, setEnabled: () => {} };
  }
  return context;
}

function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;

  const tagName = element.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  );
}

function parseHotkey(hotkey: string): {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
} {
  const parts = hotkey.toLowerCase().split('+');
  const key = parts[parts.length - 1];

  return {
    key,
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
  };
}

function normalizeKey(key: string): string {
  const keyMap: Record<string, string> = {
    escape: 'escape',
    esc: 'escape',
    enter: 'enter',
    return: 'enter',
    space: ' ',
    backspace: 'backspace',
    delete: 'delete',
    arrowup: 'arrowup',
    arrowdown: 'arrowdown',
    arrowleft: 'arrowleft',
    arrowright: 'arrowright',
  };

  const normalized = key.toLowerCase();
  return keyMap[normalized] || normalized;
}

function matchesHotkey(
  event: KeyboardEvent,
  parsed: ReturnType<typeof parseHotkey>
): boolean {
  const eventKey = normalizeKey(event.key);
  const targetKey = normalizeKey(parsed.key);

  const keyMatches = eventKey === targetKey;
  const ctrlMatches = parsed.ctrl === event.ctrlKey;
  const metaMatches = parsed.meta === event.metaKey;
  const altMatches = parsed.alt === event.altKey;
  const shiftMatches = !parsed.shift || (parsed.shift === event.shiftKey);

  return keyMatches && ctrlMatches && metaMatches && altMatches && shiftMatches;
}

export function useHotkeys(
  hotkey: string,
  callback: HotkeyCallback,
  options: { enabled?: boolean } = {}
): void {
  const { isEnabled: globalEnabled } = useHotkeysContext();
  const { enabled = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const parsed = parseHotkey(hotkey);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !globalEnabled) return;
      if (isInputElement(event.target)) return;
      if (matchesHotkey(event, parsed)) {
        event.preventDefault();
        callbackRef.current(event);
      }
    },
    [enabled, globalEnabled, parsed.key, parsed.ctrl, parsed.meta, parsed.alt, parsed.shift]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

interface SequentialHotkeyOptions {
  timeout?: number;
  enabled?: boolean;
}

export function useSequentialHotkeys(
  keys: string[],
  callback: HotkeyCallback,
  options: SequentialHotkeyOptions = {}
): void {
  const { isEnabled: globalEnabled } = useHotkeysContext();
  const { timeout = 1000, enabled = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const sequenceRef = useRef<string[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetSequence = useCallback(() => {
    sequenceRef.current = [];
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !globalEnabled) return;
      if (isInputElement(event.target)) return;

      const key = event.key.toLowerCase();

      // Reset timeout on each keypress
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      sequenceRef.current.push(key);

      // Check if sequence matches
      const currentSequence = sequenceRef.current;
      const targetSequence = keys.map(k => k.toLowerCase());

      // Check if we have a match
      let matches = true;
      for (let i = 0; i < currentSequence.length; i++) {
        if (currentSequence[i] !== targetSequence[i]) {
          matches = false;
          break;
        }
      }

      if (matches && currentSequence.length === targetSequence.length) {
        event.preventDefault();
        resetSequence();
        callbackRef.current(event);
        return;
      }

      if (!matches) {
        // Wrong key - check if this key starts a new sequence
        if (key === targetSequence[0]) {
          sequenceRef.current = [key];
        } else {
          resetSequence();
          return;
        }
      }

      // Set timeout to reset sequence
      timeoutRef.current = setTimeout(resetSequence, timeout);
    },
    [enabled, globalEnabled, keys, timeout, resetSequence]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      resetSequence();
    };
  }, [handleKeyDown, resetSequence]);
}
