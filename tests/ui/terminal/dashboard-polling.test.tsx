/**
 * Tests for dashboard polling (Issue #1867).
 *
 * Verifies that the stats and sessions hooks use refetchInterval.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn((opts) => {
      // Capture the options for assertion
      (globalThis as Record<string, unknown>)[`__lastQueryOpts_${JSON.stringify(opts.queryKey)}`] = opts;
      return { data: undefined, isLoading: true, isError: false };
    }),
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
  };
});

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Dashboard polling (#1867)', () => {
  it('useTerminalStats uses refetchInterval', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    const { useTerminalStats } = await import('@/ui/hooks/queries/use-terminal-sessions');

    useTerminalStats();

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchInterval: expect.any(Number),
      }),
    );
  });
});
