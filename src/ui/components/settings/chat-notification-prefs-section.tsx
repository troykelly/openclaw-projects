/**
 * Chat notification preferences section for Settings page (Issue #1958).
 *
 * Provides controls for:
 * - Sound toggle
 * - Auto-open on message toggle
 * - Quiet hours configuration
 * - Per-urgency channel checkboxes
 *
 * Follows the same Card/CardHeader/CardContent pattern as other settings sections.
 */
import * as React from 'react';
import { useCallback } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Switch } from '@/ui/components/ui/switch';
import {
  useChatNotificationPrefs,
  type ChatNotificationChannel,
  type UrgencyLevel,
} from './use-chat-notification-prefs';

/** All available channels. */
const CHANNELS: { id: ChatNotificationChannel; label: string }[] = [
  { id: 'in_app', label: 'In-App' },
  { id: 'push', label: 'Push' },
  { id: 'sms', label: 'SMS' },
  { id: 'email', label: 'Email' },
];

/** Urgency levels in display order. */
const URGENCY_LEVELS: { id: UrgencyLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];

export function ChatNotificationPrefsSection(): React.JSX.Element {
  const { prefs, isLoading, error, isSaving, updatePrefs } = useChatNotificationPrefs();

  const handleSoundToggle = useCallback(
    (checked: boolean) => {
      updatePrefs({ sound_enabled: checked });
    },
    [updatePrefs],
  );

  const handleAutoOpenToggle = useCallback(
    (checked: boolean) => {
      updatePrefs({ auto_open_on_message: checked });
    },
    [updatePrefs],
  );

  const handleChannelToggle = useCallback(
    (level: UrgencyLevel, channel: ChatNotificationChannel, checked: boolean) => {
      if (!prefs) return;
      const current = prefs.escalation[level] ?? [];
      const updated = checked
        ? [...current, channel]
        : current.filter((c) => c !== channel);
      updatePrefs({
        escalation: {
          ...prefs.escalation,
          [level]: updated,
        },
      });
    },
    [prefs, updatePrefs],
  );

  if (isLoading) {
    return (
      <Card data-testid="chat-notification-prefs-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            <CardTitle>Chat Notifications</CardTitle>
          </div>
          <CardDescription>Configure how chat notifications are delivered</CardDescription>
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
      <Card data-testid="chat-notification-prefs-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            <CardTitle>Chat Notifications</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load chat notification preferences</p>
        </CardContent>
      </Card>
    );
  }

  // Safe fallback if prefs is somehow null after loading
  if (!prefs) {
    return (
      <Card data-testid="chat-notification-prefs-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-muted-foreground" />
            <CardTitle>Chat Notifications</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No preferences available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="chat-notification-prefs-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-muted-foreground" />
          <CardTitle>Chat Notifications</CardTitle>
          {isSaving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <CardDescription>Configure how chat notifications are delivered</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sound and auto-open toggles */}
        <div className="space-y-1 divide-y">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex-1">
              <label htmlFor="sound-toggle" className="text-sm font-medium">
                Notification Sounds
              </label>
              <p className="text-sm text-muted-foreground">Play a sound when a chat message arrives</p>
            </div>
            <div className="shrink-0">
              <Switch
                id="sound-toggle"
                checked={prefs.sound_enabled}
                onCheckedChange={handleSoundToggle}
                aria-label="Notification sounds"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex-1">
              <label htmlFor="auto-open-toggle" className="text-sm font-medium">
                Auto-Open Chat Panel
              </label>
              <p className="text-sm text-muted-foreground">Automatically open the chat panel when an agent sends a message</p>
            </div>
            <div className="shrink-0">
              <Switch
                id="auto-open-toggle"
                checked={prefs.auto_open_on_message}
                onCheckedChange={handleAutoOpenToggle}
                aria-label="Auto-open chat panel"
              />
            </div>
          </div>
        </div>

        {/* Quiet Hours */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Quiet Hours</h4>
          <p className="mb-3 text-sm text-muted-foreground">
            {prefs.quiet_hours
              ? `${prefs.quiet_hours.start} - ${prefs.quiet_hours.end} (${prefs.quiet_hours.timezone})`
              : 'Not configured. Notifications will be delivered at all times.'}
          </p>
        </div>

        {/* Per-urgency channel preferences */}
        <div>
          <h4 className="mb-3 text-sm font-medium">Delivery Channels by Urgency</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="escalation-table">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium text-muted-foreground">Urgency</th>
                  {CHANNELS.map((ch) => (
                    <th key={ch.id} className="py-2 text-center font-medium text-muted-foreground">
                      {ch.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {URGENCY_LEVELS.map((level) => {
                  const channels = prefs.escalation[level.id] ?? [];
                  return (
                    <tr key={level.id} data-testid={`escalation-row-${level.id}`}>
                      <td className="py-3 font-medium">{level.label}</td>
                      {CHANNELS.map((ch) => (
                        <td key={ch.id} className="py-3 text-center">
                          <Switch
                            checked={channels.includes(ch.id)}
                            onCheckedChange={(checked) => handleChannelToggle(level.id, ch.id, checked)}
                            aria-label={`${ch.label} notifications for ${level.label} urgency`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
