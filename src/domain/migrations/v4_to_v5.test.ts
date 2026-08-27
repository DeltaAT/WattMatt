import { describe, expect, it } from 'vitest';

import { v4ToV5 } from '@/domain/migrations/v4_to_v5';

/**
 * v4 → v5: `round.track` and `tournament.consolation` (issue #73,
 * docs/TOURNAMENT-RULES.md §10).
 */

function v4File(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 4,
    name: 'Vereinsturnier',
    rounds: [
      { id: 'rnd_1', index: 1, kind: 'QUALIFYING', label: 'Runde 1', state: 'CLOSED', matches: [] },
      {
        id: 'rnd_2',
        index: 2,
        kind: 'ELIMINATION',
        label: 'Runde 2',
        state: 'RUNNING',
        matches: [],
      },
    ],
    ...overrides,
  };
}

describe('v4ToV5', () => {
  it('steps one version', () => {
    expect(v4ToV5.from).toBe(4);
    expect(v4ToV5.to).toBe(5);
  });

  /*
   * Not a default: v4 had no side event to be on, so every round in a v4 file
   * belongs to the main field by construction. Getting this wrong would put a
   * closed qualifying round on the `Trostrunde` board.
   */
  it('puts every existing round on the main track', () => {
    const migrated = v4ToV5.migrate(v4File());

    expect(migrated['rounds']).toEqual([
      expect.objectContaining({ id: 'rnd_1', track: 'MAIN' }),
      expect.objectContaining({ id: 'rnd_2', track: 'MAIN' }),
    ]);
  });

  it('leaves every other field of a round alone', () => {
    const before = v4File();
    const migrated = v4ToV5.migrate(before);
    const round = (migrated['rounds'] as Record<string, unknown>[])[0];

    expect(round).toEqual({
      id: 'rnd_1',
      index: 1,
      kind: 'QUALIFYING',
      label: 'Runde 1',
      state: 'CLOSED',
      matches: [],
      track: 'MAIN',
    });
  });

  /*
   * Null, not `{ state: 'DECLINED' }`. The two are different answers: a v4
   * tournament reopened with its `Hoffnungsrunde` only now closing should still
   * be offered the side event, and a file that came back already having
   * declined would take that decision away from a host who was never asked
   * (docs/OPEN-QUESTIONS.md #85).
   */
  it('leaves the consolation record unanswered', () => {
    expect(v4ToV5.migrate(v4File())['consolation']).toBeNull();
  });

  it('keeps a track a hand-repaired file already carries', () => {
    const repaired = v4File({
      rounds: [
        {
          id: 'rnd_1',
          index: 1,
          kind: 'CONSOLATION',
          track: 'CONSOLATION',
          label: 'Trostrunde 1',
          state: 'DRAWN',
          matches: [],
        },
      ],
    });

    expect((v4ToV5.migrate(repaired)['rounds'] as Record<string, unknown>[])[0]).toEqual(
      expect.objectContaining({ track: 'CONSOLATION' }),
    );
  });

  it('keeps a consolation record a hand-repaired file already carries', () => {
    const repaired = v4File({ consolation: { state: 'RUNNING', winnerId: null } });

    expect(v4ToV5.migrate(repaired)['consolation']).toEqual({ state: 'RUNNING', winnerId: null });
  });

  it('does not mutate its input', () => {
    const before = v4File();
    const rounds = before['rounds'];

    v4ToV5.migrate(before);

    expect(before['rounds']).toBe(rounds);
    expect((rounds as Record<string, unknown>[])[0]).not.toHaveProperty('track');
    expect(before).not.toHaveProperty('consolation');
  });

  /*
   * Rubbish is handed on rather than repaired, so the schema reports it with a
   * path instead of this step failing with "could not be brought up to date" —
   * the same argument `v3ToV4` makes about a `repechage` that is not one.
   */
  it.each([
    ['a missing rounds array', {}],
    ['rounds that are not an array', { rounds: 'nonsense' }],
    ['a round that is not an object', { rounds: [42] }],
  ])('hands %s on for the schema to report', (_name, overrides) => {
    expect(() => v4ToV5.migrate({ schemaVersion: 4, ...overrides })).not.toThrow();
  });
});
