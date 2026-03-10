/**
 * TanStack Query hooks for global communications data.
 *
 * Fetches all emails and calendar events (not scoped to a work item).
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { EmailsResponse, CalendarEventsResponse } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for global communications. */
export const globalCommunicationsKeys = {
  all: ['global-communications'] as const,
  emails: () => [...globalCommunicationsKeys.all, 'emails'] as const,
  calendarEvents: () => [...globalCommunicationsKeys.all, 'calendar-events'] as const,
};

/**
 * Fetch all emails.
 *
 * @returns TanStack Query result with `EmailsResponse`
 */
export function useEmails() {
  const queryKey = useNamespaceQueryKey(globalCommunicationsKeys.emails());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<EmailsResponse>('/emails', { signal }),
  });
}

/**
 * Fetch all calendar events.
 *
 * @returns TanStack Query result with `CalendarEventsResponse`
 */
export function useCalendarEvents() {
  const queryKey = useNamespaceQueryKey(globalCommunicationsKeys.calendarEvents());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<CalendarEventsResponse>('/calendar/events', { signal }),
  });
}
