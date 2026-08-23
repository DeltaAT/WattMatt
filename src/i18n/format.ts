/**
 * Date/time formatting for the UI, via `Intl` with the `de-AT` locale
 * (issue #6). Takes a `Date` rather than reading the clock itself, so callers
 * still go through the injected `Clock` (ARCHITECTURE.md §5) and this stays
 * trivially testable with a fixed instant.
 */
const dateFormatter = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium' });
const timeFormatter = new Intl.DateTimeFormat('de-AT', { timeStyle: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}
