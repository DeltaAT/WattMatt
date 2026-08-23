import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatDuration, formatTime } from '@/i18n';

// Exact separators/spacing are down to the ICU data bundled with Node, so
// these assert shape (day-month-year, 24h time) rather than an exact string.
const FIXED_INSTANT = new Date('2026-08-23T14:05:00Z');

describe('date/time formatting', () => {
  it('formats a date in de-AT order', () => {
    expect(formatDate(FIXED_INSTANT)).toMatch(/23\..*2026/);
  });

  it('formats a 24-hour time', () => {
    expect(formatTime(FIXED_INSTANT)).toMatch(/^\d{1,2}:\d{2}$/);
  });

  it('formats date and time together', () => {
    const result = formatDateTime(FIXED_INSTANT);
    expect(result).toMatch(/23\..*2026/);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

/**
 * The stopwatch on the occupancy board (issue #13). Digits, not a sentence: the
 * host reads it from across the room while doing something else.
 */
describe('formatDuration', () => {
  it('reads as minutes and seconds under an hour', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(9_000)).toBe('00:09');
    expect(formatDuration(751_000)).toBe('12:31');
    expect(formatDuration(3_599_000)).toBe('59:59');
  });

  it('grows an hours field rather than counting to 120 minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_852_000)).toBe('1:04:12');
  });

  /* Truncated, so the number never reads a second ahead of the clock it counts
   * from — a board that says 12:32 while the stopwatch says 12:31 is the kind
   * of thing a host stops trusting. */
  it('truncates the part of a second it cannot show', () => {
    expect(formatDuration(1_999)).toBe('00:01');
  });

  it('never counts backwards', () => {
    expect(formatDuration(-5_000)).toBe('00:00');
  });
});
