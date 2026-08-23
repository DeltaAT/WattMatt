import { describe, expect, it } from 'vitest';

import { timestampSchema } from '@/domain/types';
import { systemClock, toLocalTimestamp } from '@/platform/clock';

describe('toLocalTimestamp', () => {
  it('produces a timestamp the file schema accepts', () => {
    const stamp = toLocalTimestamp(new Date(2026, 7, 23, 19, 31, 12));

    expect(timestampSchema.safeParse(stamp).success).toBe(true);
  });

  /**
   * docs/FILE-FORMAT.md writes the offset out. A file repaired in Notepad at an
   * event has to be readable by someone who is not converting from UTC in their
   * head, so the local wall-clock time is what goes in.
   */
  it('writes the local wall-clock time with an explicit offset', () => {
    const date = new Date(2026, 0, 5, 9, 4, 7);

    const stamp = toLocalTimestamp(date);

    expect(stamp.startsWith('2026-01-05T09:04:07')).toBe(true);
    expect(stamp.slice(19)).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('describes the same instant the Date does', () => {
    const date = new Date(2026, 5, 1, 12, 0, 0);

    expect(new Date(toLocalTimestamp(date)).getTime()).toBe(date.getTime());
  });

  it('pads every component to two digits', () => {
    const stamp = toLocalTimestamp(new Date(2026, 0, 1, 0, 0, 0));

    expect(stamp.startsWith('2026-01-01T00:00:00')).toBe(true);
  });
});

describe('systemClock', () => {
  it('reads the wall clock in a form the domain accepts', () => {
    expect(timestampSchema.safeParse(systemClock.now()).success).toBe(true);
  });
});
