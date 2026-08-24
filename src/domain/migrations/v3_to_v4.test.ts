import { describe, expect, it } from 'vitest';

import { v3ToV4 } from '@/domain/migrations/v3_to_v4';

/**
 * The third real migration (issue #20, docs/FILE-FORMAT.md rule 7).
 *
 * v4 gave the repechage a `pool`: the candidates §4 has still to draw. Unlike
 * the two steps before it, there is nothing in a v3 file to reconstruct that
 * from — `draws` records who came *out* of the pot, never who was left in — so
 * the whole of this step is choosing the honest default and keeping every
 * neighbouring field intact while it does.
 */

function v3File(repechage: unknown): Record<string, unknown> {
  return { schemaVersion: 3, name: 'Vereinsturnier', groups: [], repechage };
}

const repechageOf = (file: Record<string, unknown>): Record<string, unknown> =>
  v3ToV4.migrate(file)['repechage'] as Record<string, unknown>;

describe('v3 → v4', () => {
  it('announces the step it takes', () => {
    expect(v3ToV4).toMatchObject({ from: 3, to: 4 });
  });

  /*
   * The common case by a distance: no released build ever wrote a repechage,
   * so every v3 file a host actually has says `null` here. A step that turned
   * that into an empty object would claim a phase happened that never did —
   * and docs/TOURNAMENT-RULES.md §9 case 2 requires the two to stay apart.
   */
  it('leaves a tournament whose repechage never happened alone', () => {
    const file = v3File(null);

    expect(v3ToV4.migrate(file)).toBe(file);
    expect(v3ToV4.migrate(file)['repechage']).toBeNull();
  });

  it('gives a repechage that has one an empty pool', () => {
    const migrated = repechageOf(
      v3File({ target: 8, draws: [{ groupId: 'grp_3', accepted: true }], fallbackUsed: null }),
    );

    expect(migrated['pool']).toEqual([]);
  });

  /*
   * An empty pool is not a dropped one. Everything v3 recorded about the phase
   * has to come back out, or a host who opens last week's tournament finds the
   * audit trail of the draws shortened (docs/FILE-FORMAT.md rule 6).
   */
  it('keeps the target, the draws and the fallback it was given', () => {
    const draws = [
      { groupId: 'grp_3', accepted: false },
      { groupId: 'grp_4', accepted: true },
    ];

    expect(repechageOf(v3File({ target: 4, draws, fallbackUsed: 'BYES' }))).toEqual({
      target: 4,
      pool: [],
      draws,
      fallbackUsed: 'BYES',
    });
  });

  /*
   * The file repaired in Notepad, which docs/FILE-FORMAT.md §Encoding invites.
   * The pool is the one field this step cannot derive, so a file that already
   * carries one knows something the default does not.
   */
  it('does not overwrite a pool the file already carries', () => {
    const file = v3File({ target: 8, pool: ['grp_5'], draws: [], fallbackUsed: null });

    expect(v3ToV4.migrate(file)).toBe(file);
  });

  it('does not mutate the file it was given', () => {
    const repechage = { target: 4, draws: [], fallbackUsed: null };
    const file = v3File(repechage);

    v3ToV4.migrate(file);

    expect(repechage).not.toHaveProperty('pool');
    expect(file['repechage']).toBe(repechage);
  });

  /*
   * Bytes that were never a repechage are handed on untouched, so the schema
   * reports them with a path rather than this step failing with "could not be
   * brought up to date".
   */
  it.each([['not a repechage'], [42], [['a', 'list']]])(
    'passes a repechage in a shape it does not expect straight through (%s)',
    (nonsense) => {
      const file = v3File(nonsense);

      expect(v3ToV4.migrate(file)).toBe(file);
    },
  );
});
