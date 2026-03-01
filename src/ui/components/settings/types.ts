export type Theme = 'light' | 'dark' | 'oled' | 'system';
export type DefaultView = 'activity' | 'projects' | 'timeline' | 'contacts';
export type EmailDigestFrequency = 'never' | 'daily' | 'weekly';

export interface UserSettings {
  id: string;
  email: string;
  theme: Theme;
  default_view: DefaultView;
  default_project_id: string | null;
  default_agent_id: string | null;
  sidebar_collapsed: boolean;
  show_completed_items: boolean;
  items_per_page: number;
  email_notifications: boolean;
  email_digest_frequency: EmailDigestFrequency;
  timezone: string;
  geo_auto_inject: boolean;
  geo_high_res_retention_hours: number;
  geo_general_retention_days: number;
  geo_high_res_threshold_m: number;
  created_at: string;
  updated_at: string;
}

export type SettingsUpdatePayload = Partial<
  Pick<
    UserSettings,
    | 'theme'
    | 'default_view'
    | 'default_project_id'
    | 'default_agent_id'
    | 'sidebar_collapsed'
    | 'show_completed_items'
    | 'items_per_page'
    | 'email_notifications'
    | 'email_digest_frequency'
    | 'timezone'
    | 'geo_auto_inject'
    | 'geo_high_res_retention_hours'
    | 'geo_general_retention_days'
    | 'geo_high_res_threshold_m'
  >
>;

export type EmbeddingProviderName = 'voyageai' | 'openai' | 'gemini';
export type EmbeddingKeySource = 'environment' | 'file' | 'command';
export type EmbeddingProviderStatus = 'active' | 'configured' | 'unconfigured';

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  status: EmbeddingProviderStatus;
  key_source: EmbeddingKeySource | null;
}

export interface AvailableProvider {
  name: EmbeddingProviderName;
  configured: boolean;
  priority: number;
}

export interface EmbeddingBudget {
  daily_limit_usd: number;
  monthly_limit_usd: number;
  today_spend_usd: number;
  month_spend_usd: number;
  pause_on_limit: boolean;
}

export interface EmbeddingUsageStats {
  count: number;
  tokens: number;
}

export interface EmbeddingUsage {
  today: EmbeddingUsageStats;
  month: EmbeddingUsageStats;
  total: EmbeddingUsageStats;
}

export interface EmbeddingSettings {
  provider: EmbeddingProvider | null;
  available_providers: AvailableProvider[];
  budget: EmbeddingBudget;
  usage: EmbeddingUsage;
}

export interface EmbeddingBudgetUpdate {
  daily_limit_usd?: number;
  monthly_limit_usd?: number;
  pause_on_limit?: boolean;
}

export interface EmbeddingTestResult {
  success: boolean;
  provider: EmbeddingProviderName | null;
  error?: string;
  latency_ms?: number;
}

// ---------------------------------------------------------------------------
// OAuth Connected Accounts
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google' | 'microsoft';
export type OAuthPermissionLevel = 'read' | 'read_write';
/** Authoritative list of OAuth features. All other references derive from this. */
export const OAUTH_FEATURES = ['contacts', 'email', 'files', 'calendar'] as const;

/** OAuth feature identifier. */
export type OAuthFeature = (typeof OAUTH_FEATURES)[number];

export interface OAuthConnectionSummary {
  id: string;
  user_email: string;
  provider: OAuthProvider;
  scopes: string[];
  expires_at: string | null;
  label: string;
  provider_account_id: string | null;
  provider_account_email: string | null;
  permission_level: OAuthPermissionLevel;
  enabled_features: OAuthFeature[];
  is_active: boolean;
  last_sync_at: string | null;
  sync_status: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OAuthConnectionUpdate {
  label?: string;
  permission_level?: OAuthPermissionLevel;
  enabled_features?: OAuthFeature[];
  is_active?: boolean;
}

export interface OAuthProviderInfo {
  name: string;
  configured: boolean;
  hint?: string;
}
