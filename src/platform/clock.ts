import { timestampSchema, type Clock, type Timestamp } from '@/domain/types';

/**
 * The wall clock, for the layer that is allowed to have one.
 *
 * `src/domain` may not read the time (ARCHITECTURE.md §5), so every domain
 * function takes a `Clock`. This is the one the app passes in; tests pass a
 * fixed one and get the same tournament twice.
 *
 * The offset is written out (`+02:00`) rather than normalised to `Z`, matching
 * docs/FILE-FORMAT.md. The file is meant to be readable in Notepad, and a host
 * checking when a round was closed should not have to convert from UTC in their
 * head at an event that runs across a daylight-saving boundary.
 */

export const systemClock: Clock = {
  now: () => toLocalTimestamp(new Date()),
};

export function toLocalTimestamp(date: Date): Timestamp {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);

  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;

  // Parsed rather than cast: this string ends up in the file, and a malformed
  // timestamp would be caught on the next read rather than here, by which time
  // the tournament is the one that will not open.
  return timestampSchema.parse(stamp);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
