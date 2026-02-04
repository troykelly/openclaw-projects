/**
 * @vitest-environment jsdom
 * Tests for mobile responsive hooks and component adaptations.
 * Issue #479: Mobile responsive pass across all views
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import {
  useMediaQuery,
  BREAKPOINTS,
  MEDIA_QUERIES,
} from '@/ui/hooks/use-media-query';

import {
  useMobileDetect,
  type MobileDetectResult,
} from '@/ui/hooks/use-mobile-detect';

import {
  MobileContainer,
} from '@/ui/components/mobile/mobile-container';

import {
  TouchTarget,
} from '@/ui/components/mobile/touch-target';

// ---------------------------------------------------------------------------
// matchMedia mock helper
// ---------------------------------------------------------------------------

type MatchMediaHandler = (e: MediaQueryListEvent) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  _listeners: MatchMediaHandler[];
  _triggerChange: (newMatches: boolean) => void;
}

/**
 * Create a matchMedia mock where each query gets its own listener list.
 * Callers pass a `resolver` function that decides the initial `matches` value.
 */
function createMatchMediaMock(
  resolver: (query: string) => boolean,
): { mock: typeof window.matchMedia; instances: Map<string, MockMediaQueryList> } {
  const instances = new Map<string, MockMediaQueryList>();

  const mock = vi.fn().mockImplementation((query: string): MockMediaQueryList => {
    const listeners: MatchMediaHandler[] = [];
    const mql: MockMediaQueryList = {
      matches: resolver(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: MatchMediaHandler) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn((_event: string, handler: MatchMediaHandler) => {
        const idx = listeners.indexOf(handler);
        if (idx > -1) listeners.splice(idx, 1);
      }),
      dispatchEvent: vi.fn(),
      _listeners: listeners,
      _triggerChange(newMatches: boolean) {
        mql.matches = newMatches;
        listeners.forEach((fn) => fn({ matches: newMatches } as MediaQueryListEvent));
      },
    };
    instances.set(query, mql);
    return mql;
  });

  return { mock: mock as unknown as typeof window.matchMedia, instances };
}

// ---------------------------------------------------------------------------
// Test wrappers for hooks
// ---------------------------------------------------------------------------

function UseMediaQueryTestHarness({ query }: { query: string }) {
  const matches = useMediaQuery(query);
  return <div data-testid="result">{matches ? 'true' : 'false'}</div>;
}

function UseMobileDetectTestHarness() {
  const result = useMobileDetect();
  return (
    <div>
      <span data-testid="isMobile">{String(result.isMobile)}</span>
      <span data-testid="isTablet">{String(result.isTablet)}</span>
      <span data-testid="isDesktop">{String(result.isDesktop)}</span>
      <span data-testid="isMobileOrTablet">{String(result.isMobileOrTablet)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMediaQuery', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('should return true when the media query matches', () => {
    const { mock } = createMatchMediaMock((q) => q === '(max-width: 767px)');
    window.matchMedia = mock;

    render(<UseMediaQueryTestHarness query="(max-width: 767px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('true');
  });

  it('should return false when the media query does not match', () => {
    const { mock } = createMatchMediaMock(() => false);
    window.matchMedia = mock;

    render(<UseMediaQueryTestHarness query="(max-width: 767px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('false');
  });

  it('should update when the media query match state changes', () => {
    const { mock, instances } = createMatchMediaMock(() => false);
    window.matchMedia = mock;

    render(<UseMediaQueryTestHarness query="(min-width: 1025px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('false');

    // Simulate a viewport change
    const mql = instances.get('(min-width: 1025px)');
    expect(mql).toBeDefined();

    act(() => {
      mql!._triggerChange(true);
    });

    expect(screen.getByTestId('result')).toHaveTextContent('true');
  });

  it('should clean up listeners on unmount', () => {
    const { mock, instances } = createMatchMediaMock(() => true);
    window.matchMedia = mock;

    const { unmount } = render(<UseMediaQueryTestHarness query="(max-width: 767px)" />);
    const mql = instances.get('(max-width: 767px)');
    expect(mql).toBeDefined();
    expect(mql!.removeEventListener).not.toHaveBeenCalled();

    unmount();

    expect(mql!.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});

describe('useMobileDetect', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('should detect a mobile viewport', () => {
    const { mock } = createMatchMediaMock((q) => q === MEDIA_QUERIES.mobile);
    window.matchMedia = mock;

    render(<UseMobileDetectTestHarness />);

    expect(screen.getByTestId('isMobile')).toHaveTextContent('true');
    expect(screen.getByTestId('isTablet')).toHaveTextContent('false');
    expect(screen.getByTestId('isDesktop')).toHaveTextContent('false');
    expect(screen.getByTestId('isMobileOrTablet')).toHaveTextContent('true');
  });

  it('should detect a tablet viewport', () => {
    const { mock } = createMatchMediaMock((q) => q === MEDIA_QUERIES.tablet);
    window.matchMedia = mock;

    render(<UseMobileDetectTestHarness />);

    expect(screen.getByTestId('isMobile')).toHaveTextContent('false');
    expect(screen.getByTestId('isTablet')).toHaveTextContent('true');
    expect(screen.getByTestId('isDesktop')).toHaveTextContent('false');
    expect(screen.getByTestId('isMobileOrTablet')).toHaveTextContent('true');
  });

  it('should detect a desktop viewport', () => {
    const { mock } = createMatchMediaMock((q) => q === MEDIA_QUERIES.desktop);
    window.matchMedia = mock;

    render(<UseMobileDetectTestHarness />);

    expect(screen.getByTestId('isMobile')).toHaveTextContent('false');
    expect(screen.getByTestId('isTablet')).toHaveTextContent('false');
    expect(screen.getByTestId('isDesktop')).toHaveTextContent('true');
    expect(screen.getByTestId('isMobileOrTablet')).toHaveTextContent('false');
  });

  it('should report isMobileOrTablet=true when on mobile', () => {
    const { mock } = createMatchMediaMock((q) => q === MEDIA_QUERIES.mobile);
    window.matchMedia = mock;

    render(<UseMobileDetectTestHarness />);
    expect(screen.getByTestId('isMobileOrTablet')).toHaveTextContent('true');
  });
});

describe('BREAKPOINTS constants', () => {
  it('should define mobile breakpoint at 768', () => {
    expect(BREAKPOINTS.mobile).toBe(768);
  });

  it('should define tablet breakpoint at 1024', () => {
    expect(BREAKPOINTS.tablet).toBe(1024);
  });
});

describe('MEDIA_QUERIES constants', () => {
  it('should contain correct mobile query', () => {
    expect(MEDIA_QUERIES.mobile).toBe('(max-width: 767px)');
  });

  it('should contain correct tablet query', () => {
    expect(MEDIA_QUERIES.tablet).toBe('(min-width: 768px) and (max-width: 1024px)');
  });

  it('should contain correct desktop query', () => {
    expect(MEDIA_QUERIES.desktop).toBe('(min-width: 1025px)');
  });
});

describe('MobileContainer responsive rendering', () => {
  it('should render with mobile-friendly padding classes', () => {
    render(<MobileContainer><span>Test content</span></MobileContainer>);
    const container = screen.getByTestId('mobile-container');
    expect(container).toHaveClass('px-4');
    expect(container).toHaveClass('py-2');
    expect(container).toHaveClass('w-full');
  });

  it('should apply custom className alongside defaults', () => {
    render(
      <MobileContainer className="bg-red-500">
        <span>Custom</span>
      </MobileContainer>
    );
    const container = screen.getByTestId('mobile-container');
    expect(container).toHaveClass('bg-red-500');
    expect(container).toHaveClass('w-full');
  });
});

describe('TouchTarget touch-friendly sizing', () => {
  it('should default to 44px minimum (md size)', () => {
    render(<TouchTarget><button type="button">Tap</button></TouchTarget>);
    const wrapper = screen.getByTestId('touch-target');
    // md = min-h-11 min-w-11 (44px)
    expect(wrapper).toHaveClass('min-h-11');
    expect(wrapper).toHaveClass('min-w-11');
  });

  it('should apply sm size (36px minimum)', () => {
    render(<TouchTarget size="sm"><button type="button">Small</button></TouchTarget>);
    const wrapper = screen.getByTestId('touch-target');
    expect(wrapper).toHaveClass('min-h-9');
    expect(wrapper).toHaveClass('min-w-9');
  });

  it('should apply lg size (56px minimum)', () => {
    render(<TouchTarget size="lg"><button type="button">Large</button></TouchTarget>);
    const wrapper = screen.getByTestId('touch-target');
    expect(wrapper).toHaveClass('min-h-14');
    expect(wrapper).toHaveClass('min-w-14');
  });
});

describe('useMediaQuery responds to dynamic changes', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('should toggle from not-matching to matching on viewport change', () => {
    const { mock, instances } = createMatchMediaMock(() => true);
    window.matchMedia = mock;

    render(<UseMediaQueryTestHarness query="(max-width: 767px)" />);
    expect(screen.getByTestId('result')).toHaveTextContent('true');

    // Simulate resize to desktop
    act(() => {
      instances.get('(max-width: 767px)')!._triggerChange(false);
    });

    expect(screen.getByTestId('result')).toHaveTextContent('false');

    // Simulate resize back to mobile
    act(() => {
      instances.get('(max-width: 767px)')!._triggerChange(true);
    });

    expect(screen.getByTestId('result')).toHaveTextContent('true');
  });
});
