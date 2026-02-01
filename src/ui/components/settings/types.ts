export type Theme = 'light' | 'dark' | 'system';
export type DefaultView = 'activity' | 'projects' | 'timeline' | 'contacts';
export type EmailDigestFrequency = 'never' | 'daily' | 'weekly';

export interface UserSettings {
  id: string;
  email: string;
  theme: Theme;
  default_view: DefaultView;
  default_project_id: string | null;
  sidebar_collapsed: boolean;
  show_completed_items: boolean;
  items_per_page: number;
  email_notifications: boolean;
  email_digest_frequency: EmailDigestFrequency;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export type SettingsUpdatePayload = Partial<
  Pick<
    UserSettings,
    | 'theme'
    | 'default_view'
    | 'default_project_id'
    | 'sidebar_collapsed'
    | 'show_completed_items'
    | 'items_per_page'
    | 'email_notifications'
    | 'email_digest_frequency'
    | 'timezone'
  >
>;
