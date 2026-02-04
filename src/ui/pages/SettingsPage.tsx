/**
 * Settings page.
 *
 * Delegates rendering to the SettingsPage component from the settings
 * module, wrapping it with the standard page test ID.
 */
import { SettingsPage as SettingsPageComponent } from '@/ui/components/settings';

export function SettingsPage(): React.JSX.Element {
  return (
    <div data-testid="page-settings">
      <SettingsPageComponent />
    </div>
  );
}
