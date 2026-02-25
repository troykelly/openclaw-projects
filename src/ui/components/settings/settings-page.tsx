/**
 * Settings page with sidebar navigation.
 *
 * Provides section-based navigation for Profile, Appearance, Notifications,
 * Keyboard Shortcuts, and About. On mobile, the sidebar collapses into a
 * vertical list. Changes save immediately with visual confirmation.
 */

import { Bell, CheckCircle, Clock, Eye, Info, Keyboard, Layout, Link2, MapPin, Monitor, Moon, Radio, Smartphone, Sun, User, Webhook } from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/ui/components/feedback';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Separator } from '@/ui/components/ui/separator';
import { Switch } from '@/ui/components/ui/switch';
import { cn } from '@/ui/lib/utils';
import { APP_VERSION } from '@/ui/lib/version';
import { ConnectedAccountsSection } from './connected-accounts-section';
import { EmbeddingSettingsSection } from './embedding-settings-section';
import { InboundRoutingSection } from './inbound-routing-section';
import { LocationSection } from './location-section';
import { NotificationPreferencesSection } from './notification-preferences-section';
import { WebhookManagementSection } from './webhook-management-section';
import type { DefaultView, EmailDigestFrequency, Theme } from './types';
import { useSettings } from './use-settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
];

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 75, 100];

/** Navigation sections for the settings sidebar. */
const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'accounts', label: 'Connected Accounts', icon: Link2 },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'routing', label: 'Inbound Routing', icon: Radio },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/** Keyboard shortcut data for the shortcuts section. */
const KEYBOARD_SHORTCUTS = [
  {
    group: 'Global',
    shortcuts: [
      { keys: ['Cmd/Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Cmd/Ctrl', '/'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal / cancel' },
    ],
  },
  {
    group: 'Navigation',
    shortcuts: [
      { keys: ['G', 'then', 'A'], description: 'Go to Activity' },
      { keys: ['G', 'then', 'P'], description: 'Go to Projects' },
      { keys: ['G', 'then', 'T'], description: 'Go to Timeline' },
      { keys: ['G', 'then', 'C'], description: 'Go to Contacts' },
      { keys: ['G', 'then', 'S'], description: 'Go to Settings' },
    ],
  },
  {
    group: 'Work Items',
    shortcuts: [
      { keys: ['N'], description: 'Quick add new item' },
      { keys: ['Shift', 'N'], description: 'Full create form' },
      { keys: ['J'], description: 'Next item in list' },
      { keys: ['K'], description: 'Previous item in list' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ThemeOptionProps {
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isSelected: boolean;
  onChange: (theme: Theme) => void;
  description?: string;
}

function ThemeOption({ value, label, icon: Icon, isSelected, onChange, description }: ThemeOptionProps) {
  return (
    <label
      data-testid={`theme-option-${value}`}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all',
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50',
      )}
    >
      <input type="radio" name="theme" value={value} checked={isSelected} onChange={() => onChange(value)} className="sr-only" aria-label={label} />
      <Icon className={cn('size-6', isSelected ? 'text-primary' : 'text-muted-foreground')} />
      <span className={cn('text-sm font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
      {description && <span className="text-[10px] text-muted-foreground text-center">{description}</span>}
    </label>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

function SettingRow({ label, description, children, htmlFor }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Save confirmation toast. */
function SaveConfirmation({ visible }: { visible: boolean }) {
  return (
    <div
      data-testid="save-confirmation"
      className={cn(
        'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none',
      )}
    >
      <CheckCircle className="size-4" />
      Saved
    </div>
  );
}

/** Key combination display. */
function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          {key === 'then' ? (
            <span className="text-xs text-muted-foreground">then</span>
          ) : (
            <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
              {key}
            </kbd>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Components
// ---------------------------------------------------------------------------

interface ProfileSectionProps {
  email: string;
  id: string;
}

function ProfileSection({ email, id }: ProfileSectionProps) {
  const initials = email
    .split('@')[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Card data-testid="settings-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <User className="size-5 text-muted-foreground" />
          <CardTitle>Profile</CardTitle>
        </div>
        <CardDescription>Your account information</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
            {initials || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">ID: {id}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface AppearanceSectionProps {
  theme: Theme;
  defaultView: DefaultView;
  sidebarCollapsed: boolean;
  showCompleted: boolean;
  itemsPerPage: number;
  timezone: string;
  onThemeChange: (theme: Theme) => void;
  onDefaultViewChange: (view: DefaultView) => void;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onShowCompletedChange: (show: boolean) => void;
  onItemsPerPageChange: (value: string) => void;
  onTimezoneChange: (tz: string) => void;
}

function AppearanceSection({
  theme,
  defaultView,
  sidebarCollapsed,
  showCompleted,
  itemsPerPage,
  timezone,
  onThemeChange,
  onDefaultViewChange,
  onSidebarCollapsedChange,
  onShowCompletedChange,
  onItemsPerPageChange,
  onTimezoneChange,
}: AppearanceSectionProps) {
  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card data-testid="settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sun className="size-5 text-muted-foreground" />
            <CardTitle>Appearance</CardTitle>
          </div>
          <CardDescription>Customize how the application looks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="mb-3 block text-sm font-medium">Theme</label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ThemeOption value="light" label="Light" icon={Sun} isSelected={theme === 'light'} onChange={onThemeChange} />
                <ThemeOption value="dark" label="Dark" icon={Moon} isSelected={theme === 'dark'} onChange={onThemeChange} />
                <ThemeOption value="oled" label="OLED" icon={Smartphone} isSelected={theme === 'oled'} onChange={onThemeChange} description="True black" />
                <ThemeOption value="system" label="System" icon={Monitor} isSelected={theme === 'system'} onChange={onThemeChange} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <Card data-testid="settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layout className="size-5 text-muted-foreground" />
            <CardTitle>Navigation</CardTitle>
          </div>
          <CardDescription>Configure your default views and layout</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 divide-y">
          <SettingRow label="Default View" description="The page to show when you open the app">
            <Select value={defaultView} onValueChange={(v) => onDefaultViewChange(v as DefaultView)}>
              <SelectTrigger className="w-[140px]" aria-label="Default view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity">Activity</SelectItem>
                <SelectItem value="projects">Projects</SelectItem>
                <SelectItem value="timeline">Timeline</SelectItem>
                <SelectItem value="contacts">People</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label="Sidebar Collapsed" description="Start with the sidebar collapsed" htmlFor="sidebar-collapsed">
            <Switch id="sidebar-collapsed" checked={sidebarCollapsed} onCheckedChange={onSidebarCollapsedChange} aria-label="Sidebar collapsed" />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Display */}
      <Card data-testid="settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Eye className="size-5 text-muted-foreground" />
            <CardTitle>Display</CardTitle>
          </div>
          <CardDescription>Control what items are shown</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 divide-y">
          <SettingRow label="Show Completed Items" description="Show completed items in lists" htmlFor="show-completed">
            <Switch id="show-completed" checked={showCompleted} onCheckedChange={onShowCompletedChange} aria-label="Show completed items" />
          </SettingRow>

          <SettingRow label="Items Per Page" description="Number of items to show in lists">
            <Select value={String(itemsPerPage)} onValueChange={onItemsPerPageChange}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEMS_PER_PAGE_OPTIONS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Regional */}
      <Card data-testid="settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            <CardTitle>Regional</CardTitle>
          </div>
          <CardDescription>Configure regional preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow label="Timezone" description="Your timezone for displaying dates and times">
            <Select value={timezone} onValueChange={onTimezoneChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Embedding Settings */}
      <EmbeddingSettingsSection />
    </div>
  );
}

interface NotificationsSectionProps {
  emailNotifications: boolean;
  emailDigestFrequency: EmailDigestFrequency;
  onEmailNotificationsChange: (enabled: boolean) => void;
  onDigestFrequencyChange: (frequency: EmailDigestFrequency) => void;
}

function NotificationsSection({ emailNotifications, emailDigestFrequency, onEmailNotificationsChange, onDigestFrequencyChange }: NotificationsSectionProps) {
  return (
    <Card data-testid="settings-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-muted-foreground" />
          <CardTitle>Notifications</CardTitle>
        </div>
        <CardDescription>Configure how you receive notifications</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 divide-y">
        <SettingRow label="Email Notifications" description="Receive email notifications for updates" htmlFor="email-notifications">
          <Switch id="email-notifications" checked={emailNotifications} onCheckedChange={onEmailNotificationsChange} aria-label="Email notifications" />
        </SettingRow>

        <SettingRow label="Email Digest" description="How often to receive digest emails">
          <Select value={emailDigestFrequency} onValueChange={(v) => onDigestFrequencyChange(v as EmailDigestFrequency)} disabled={!emailNotifications}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </CardContent>
    </Card>
  );
}

function KeyboardShortcutsSection() {
  return (
    <Card data-testid="settings-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Keyboard className="size-5 text-muted-foreground" />
          <CardTitle>Keyboard Shortcuts</CardTitle>
        </div>
        <CardDescription>Speed up your workflow with keyboard shortcuts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {KEYBOARD_SHORTCUTS.map((group) => (
            <div key={group.group}>
              <h4 className="mb-3 text-sm font-medium text-foreground">{group.group}</h4>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                    <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                    <KeyCombo keys={shortcut.keys} />
                  </div>
                ))}
              </div>
              {group !== KEYBOARD_SHORTCUTS[KEYBOARD_SHORTCUTS.length - 1] && <Separator className="mt-4" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AboutSection() {
  return (
    <Card data-testid="settings-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Info className="size-5 text-muted-foreground" />
          <CardTitle>About</CardTitle>
        </div>
        <CardDescription>Application information</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Application</span>
              <span className="text-sm font-medium">OpenClaw Projects</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <Badge variant="outline">{APP_VERSION}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">License</span>
              <span className="text-sm font-medium">MIT</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Documentation</span>
              <a href="https://docs.openclaw.ai/" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                docs.openclaw.ai
              </a>
            </div>
          </div>
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center">
            <p className="text-sm text-muted-foreground">Built for integration with the OpenClaw AI agent gateway.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { state, isSaving, updateSettings } = useSettings();
  const [activeSection, setActiveSection] = useState<SectionId>('profile');
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
    profile: null,
    accounts: null,
    location: null,
    appearance: null,
    notifications: null,
    routing: null,
    webhooks: null,
    shortcuts: null,
    about: null,
  });

  /** Show brief save confirmation when settings are saved. */
  const showSaved = useCallback(() => {
    setShowSaveConfirmation(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setShowSaveConfirmation(false), 2000);
  }, []);

  /** Wrap updateSettings to also show confirmation. */
  const handleUpdate = useCallback(
    async (updates: Parameters<typeof updateSettings>[0]) => {
      const success = await updateSettings(updates);
      if (success) showSaved();
      return success;
    },
    [updateSettings, showSaved],
  );

  const handleThemeChange = useCallback(
    (theme: Theme) => {
      handleUpdate({ theme });
      // Live preview: update the dark mode class on the document
      const root = document.documentElement;
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = theme === 'dark' || theme === 'oled' || (theme === 'system' && mediaQuery.matches);
      root.classList.toggle('dark', isDark);
      // OLED mode: add/remove oled class for true black background
      root.classList.toggle('oled', theme === 'oled');
      localStorage.setItem('theme', theme);
    },
    [handleUpdate],
  );

  const handleDefaultViewChange = useCallback(
    (view: DefaultView) => {
      handleUpdate({ default_view: view });
    },
    [handleUpdate],
  );

  const handleTimezoneChange = useCallback(
    (timezone: string) => {
      handleUpdate({ timezone });
    },
    [handleUpdate],
  );

  const handleItemsPerPageChange = useCallback(
    (value: string) => {
      handleUpdate({ items_per_page: Number.parseInt(value, 10) });
    },
    [handleUpdate],
  );

  const handleDigestFrequencyChange = useCallback(
    (frequency: EmailDigestFrequency) => {
      handleUpdate({ email_digest_frequency: frequency });
    },
    [handleUpdate],
  );

  /** Scroll to section on sidebar click. */
  const scrollToSection = useCallback((sectionId: SectionId) => {
    setActiveSection(sectionId);
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Clean up save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-8">
            <div className="hidden w-48 shrink-0 space-y-2 md:block">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
            <div className="flex-1 space-y-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-destructive">Error</h2>
          <p className="mt-2 text-muted-foreground">{state.message}</p>
          {state.status === 401 && (
            <button type="button" onClick={() => window.location.reload()} className="mt-4 inline-block text-primary hover:underline">
              Sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  const settings = state.data;

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
          <div className="flex items-center gap-2">
            {isSaving && (
              <span className="text-sm text-muted-foreground" data-testid="saving-indicator">
                Saving...
              </span>
            )}
          </div>
        </div>

        {/* Layout: sidebar + content */}
        <div className="flex flex-col gap-8 md:flex-row">
          {/* Sidebar navigation */}
          <nav data-testid="settings-sidebar" className="w-full shrink-0 md:w-48 md:sticky md:top-6 md:self-start">
            <ul className="flex flex-row gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0.5 md:pb-0">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(id)}
                    data-testid={`settings-nav-${id}`}
                    className={cn(
                      'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      activeSection === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Main content */}
          <div className="min-w-0 flex-1 space-y-8">
            {/* Profile */}
            <div
              ref={(el) => {
                sectionRefs.current.profile = el;
              }}
            >
              <ProfileSection email={settings.email} id={settings.id} />
            </div>

            {/* Connected Accounts */}
            <div
              ref={(el) => {
                sectionRefs.current.accounts = el;
              }}
            >
              <ConnectedAccountsSection />
            </div>

            {/* Location */}
            <div
              ref={(el) => {
                sectionRefs.current.location = el;
              }}
            >
              <LocationSection
                geoAutoInject={settings.geo_auto_inject}
                geoHighResRetentionHours={settings.geo_high_res_retention_hours}
                geoGeneralRetentionDays={settings.geo_general_retention_days}
                onUpdate={handleUpdate}
              />
            </div>

            {/* Appearance */}
            <div
              ref={(el) => {
                sectionRefs.current.appearance = el;
              }}
            >
              <AppearanceSection
                theme={settings.theme}
                defaultView={settings.default_view}
                sidebarCollapsed={settings.sidebar_collapsed}
                showCompleted={settings.show_completed_items}
                itemsPerPage={settings.items_per_page}
                timezone={settings.timezone}
                onThemeChange={handleThemeChange}
                onDefaultViewChange={handleDefaultViewChange}
                onSidebarCollapsedChange={(checked) => handleUpdate({ sidebar_collapsed: checked })}
                onShowCompletedChange={(checked) => handleUpdate({ show_completed_items: checked })}
                onItemsPerPageChange={handleItemsPerPageChange}
                onTimezoneChange={handleTimezoneChange}
              />
            </div>

            {/* Notifications */}
            <div
              ref={(el) => {
                sectionRefs.current.notifications = el;
              }}
            >
              <NotificationsSection
                emailNotifications={settings.email_notifications}
                emailDigestFrequency={settings.email_digest_frequency}
                onEmailNotificationsChange={(checked) => handleUpdate({ email_notifications: checked })}
                onDigestFrequencyChange={handleDigestFrequencyChange}
              />
            </div>

            {/* Per-type Notification Preferences (#1729) */}
            <NotificationPreferencesSection />

            {/* Inbound Routing */}
            <div
              ref={(el) => {
                sectionRefs.current.routing = el;
              }}
            >
              <InboundRoutingSection />
            </div>

            {/* Webhooks (#1733) */}
            <div
              ref={(el) => {
                sectionRefs.current.webhooks = el;
              }}
            >
              <WebhookManagementSection />
            </div>

            {/* Keyboard Shortcuts */}
            <div
              ref={(el) => {
                sectionRefs.current.shortcuts = el;
              }}
            >
              <KeyboardShortcutsSection />
            </div>

            {/* About */}
            <div
              ref={(el) => {
                sectionRefs.current.about = el;
              }}
            >
              <AboutSection />
            </div>
          </div>
        </div>
      </div>

      {/* Save confirmation */}
      <SaveConfirmation visible={showSaveConfirmation} />
    </div>
  );
}
