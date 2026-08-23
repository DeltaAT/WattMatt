import { describe, expect, it } from 'vitest';

import { tournamentIdSchema } from '@/domain/ids';
import { generateTournamentId } from '@/platform/id';

describe('generateTournamentId', () => {
  it('produces an id the domain accepts', () => {
    expect(tournamentIdSchema.safeParse(generateTournamentId()).success).toBe(true);
  });

  it('uses the prefix docs/FILE-FORMAT.md writes', () => {
    expect(generateTournamentId()).toMatch(/^tnm_[0-9a-f]{16}$/);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, generateTournamentId));

    expect(ids.size).toBe(200);
  });
});
