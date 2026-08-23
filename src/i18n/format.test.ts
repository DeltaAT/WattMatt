import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from '@/i18n';

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
