export type Theme = 'light' | 'dark' | 'oled' | 'system';
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

export type EmbeddingProviderName = 'voyageai' | 'openai' | 'gemini';
export type EmbeddingKeySource = 'environment' | 'file' | 'command';
export type EmbeddingProviderStatus = 'active' | 'configured' | 'unconfigured';

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  status: EmbeddingProviderStatus;
  keySource: EmbeddingKeySource | null;
}

export interface AvailableProvider {
  name: EmbeddingProviderName;
  configured: boolean;
  priority: number;
}

export interface EmbeddingBudget {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  todaySpendUsd: number;
  monthSpendUsd: number;
  pauseOnLimit: boolean;
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
  availableProviders: AvailableProvider[];
  budget: EmbeddingBudget;
  usage: EmbeddingUsage;
}

export interface EmbeddingBudgetUpdate {
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  pauseOnLimit?: boolean;
}

export interface EmbeddingTestResult {
  success: boolean;
  provider: EmbeddingProviderName | null;
  error?: string;
  latencyMs?: number;
}
