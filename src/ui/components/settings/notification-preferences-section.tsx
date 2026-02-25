/**
 * Per-type notification preferences section for the Settings page.
 *
 * Fetches notification preferences from GET /api/notifications/preferences
 * and allows toggling in-app and email delivery per notification type.
 *
 * @see Issue #1729
 */
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import { apiClient } from '@/ui/lib/api-client';

/** Preference channels for a single notification type. */
interface NotificationTypePreference {
  in_app: boolean;
  email: boolean;
}

/** Map of notification type → channel preferences. */
type NotificationPreferences = Record<string, NotificationTypePreference>;

/** Human-readable labels for notification types. */
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  assigned: 'Assigned to you',
  mentioned: 'Mentioned',
  status_change: 'Status changes',
  unblocked: 'Unblocked items',
  due_soon: 'Due soon reminders',
  comment: 'New comments',
  reminder: 'Reminders',
};

/** Get a display label for a notification type. */
function getTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NotificationPreferencesSection(): React.JSX.Element {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const data = await apiClient.get<NotificationPreferences>('/api/notifications/preferences');
        if (!alive) return;
        setPreferences(data);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load notification preferences');
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = useCallback(
    async (type: string, channel: 'in_app' | 'email', value: boolean) => {
      if (!preferences) return;

      // Optimistic update
      const previous = { ...preferences };
      setPreferences({
        ...preferences,
        [type]: { ...preferences[type], [channel]: value },
      });
      setIsSaving(true);

      try {
        await apiClient.patch<NotificationPreferences>('/api/notifications/preferences', {
          [type]: { ...preferences[type], [channel]: value },
        });
      } catch {
        // Roll back on error
        setPreferences(previous);
      } finally {
        setIsSaving(false);
      }
    },
    [preferences],
  );

  if (isLoading) {
    return (
      <Card data-testid="notification-preferences-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            <CardTitle>Notification Preferences</CardTitle>
          </div>
          <CardDescription>Configure delivery channels per notification type</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="notification-preferences-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            <CardTitle>Notification Preferences</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const types = Object.keys(preferences ?? {});

  return (
    <Card data-testid="notification-preferences-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-muted-foreground" />
          <CardTitle>Notification Preferences</CardTitle>
          {isSaving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <CardDescription>Configure delivery channels per notification type</CardDescription>
      </CardHeader>
      <CardContent>
        {types.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notification types configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="notification-preferences-table">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium text-muted-foreground">Type</th>
                  <th className="py-2 text-center font-medium text-muted-foreground">In-App</th>
                  <th className="py-2 text-center font-medium text-muted-foreground">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {types.map((type) => {
                  const pref = preferences![type];
                  return (
                    <tr key={type} data-testid={`notification-pref-row-${type}`}>
                      <td className="py-3 font-medium">{getTypeLabel(type)}</td>
                      <td className="py-3 text-center">
                        <Switch
                          checked={pref.in_app}
                          onCheckedChange={(checked) => handleToggle(type, 'in_app', checked)}
                          aria-label={`In-app notifications for ${getTypeLabel(type)}`}
                        />
                      </td>
                      <td className="py-3 text-center">
                        <Switch
                          checked={pref.email}
                          onCheckedChange={(checked) => handleToggle(type, 'email', checked)}
                          aria-label={`Email notifications for ${getTypeLabel(type)}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
