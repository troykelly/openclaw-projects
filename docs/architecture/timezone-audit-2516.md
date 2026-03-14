# Timezone Usage Audit — Issue #2516

Date: 2026-03-14
Epic: #2509

## Summary

`user_setting.timezone` is **stored and returned** via the settings API but **not consumed** by any server-side or client-side feature. Three other timezone columns exist for specific subsystems (skill store schedules, chat quiet hours, contact quiet hours), each fully functional in isolation.

## Where Timezone IS Used

| Subsystem | Column / Field | How It's Used |
|-----------|----------------|---------------|
| Skill store schedules | `skill_store_schedule.timezone` | `computeNextRunAt()` evaluates cron in this timezone |
| Chat quiet hours | `chat_notification_prefs.quiet_hours.timezone` | `isInQuietHours()` checks current time in this timezone |
| Contact quiet hours | `contact.quiet_hours_timezone` | Stored per-contact; displayed in UI |
| Contact metadata | `contact.timezone` (migration 030) | Stored per-contact for reference |

## Where `user_setting.timezone` Is NOT Used

| Feature | Current Behavior | Impact |
|---------|-----------------|--------|
| Frontend date rendering | Browser timezone via `toLocaleString()` | Dates may differ from stored preference |
| Bootstrap `due_today` | PostgreSQL `CURRENT_DATE` (server TZ) | Incorrect "due today" for non-UTC users |
| Note export (PDF/DOCX) | Server timezone (UTC) | Exported dates always in UTC |
| Email digest scheduling | Not implemented | N/A until built |
| Reminders / `not_before` | UTC `timestamptz` — correct server-side | UI should display in user timezone |
| Recurrence service | No timezone awareness | Recurrence patterns may drift |
| Calendar API | No timezone parameter | Calendar queries are timezone-agnostic |

## Banner Copy Verdict

The #2510 banner states: "Updating will affect how reminders, quiet hours, and dates are shown across the app."

**This is inaccurate.** `user_setting.timezone` does not currently affect any of these. Recommended revision: "Your timezone is stored for future use in date display and scheduling features."

## Child Issues

- #2517 — Frontend: Use stored timezone for date rendering
- #2518 — Backend: Use user timezone in bootstrap `due_today`
- #2519 — Backend: Use user timezone in note export
- #2520 — Backend: Email digest timezone tracking
