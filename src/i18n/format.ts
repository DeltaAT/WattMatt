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

/**
 * A running duration for the occupancy board: `12:31`, or `1:04:12` past an
 * hour (issue #13).
 *
 * Digits and colons rather than `Intl.RelativeTimeFormat`: the host reads this
 * from across the room while doing something else, and "vor 12 Minuten" is a
 * sentence where a stopwatch is wanted. Nothing here is translated, which is
 * why it can live outside the locale file.
 *
 * Seconds are truncated, not rounded, so the number never reads one second
 * ahead of the clock it is counting from.
 */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const tail = `${pad(minutes)}:${pad(seconds)}`;
  return hours === 0 ? tail : `${hours}:${tail}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
