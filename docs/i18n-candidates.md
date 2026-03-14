# i18n Candidates

Hardcoded English strings that are candidates for future internationalization.
These strings are currently embedded in UI components and should be extracted
into a localization system when i18n support is added.

---

## TimezoneMismatchBanner (Epic #2509)

Component: `TimezoneMismatchBanner`
Related issues: #2512, #2515

| String | Context |
|--------|---------|
| `"Your device timezone has changed"` | Banner heading when browser TZ differs from stored TZ |
| `"Your account is set to {storedTz} but your device reports {browserTz}. Updating will affect how reminders, quiet hours, and dates are shown across the app."` | Banner explanation body |
| `"Update to {browserTz}"` | Primary action button label |
| `"Keep {storedTz}"` | Dismiss/secondary action button label |
| `"Timezone updated to {browserTz}"` | Success toast after update |
| `"Failed to update timezone. Try again or update in Settings."` | Error toast on update failure |

### Notes

- `{storedTz}` and `{browserTz}` are interpolated IANA timezone identifiers
  (e.g. `"America/New_York"`, `"Australia/Sydney"`)
- These strings contain user-facing technical identifiers (IANA TZ names) that
  may also need localized display names in the future
