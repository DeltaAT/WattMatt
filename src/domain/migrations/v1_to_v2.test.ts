import { describe, expect, it } from 'vitest';

import { v1ToV2 } from '@/domain/migrations/v1_to_v2';
import { tableSchema } from '@/domain/types';

/**
 * The first real migration (issue #13, docs/FILE-FORMAT.md rule 7).
 *
 * v2 gave tables an `occupiedSince` stamp and made the three occupancy fields a
 * checked invariant. What is asserted here is the part a v1 file cannot supply
 * on its own: where the stamp comes from, and what happens to a table that v1
 * allowed to be busy without saying what it was busy with.
 */

const UPDATED_AT = '2026-08-22T19:31:12+02:00';

function v1File(tables: unknown[]): Record<string, unknown> {
  return { schemaVersion: 1, name: 'Vereinsturnier', updatedAt: UPDATED_AT, tables };
}

const OCCUPIED = { id: 'tbl_1', label: 'Tisch 1', status: 'OCCUPIED', currentMatchId: 'mt_3' };
const FREE = { id: 'tbl_2', label: 'Tisch 2', status: 'FREE', currentMatchId: null };
const DISABLED = { id: 'tbl_3', label: 'Tisch 3', status: 'DISABLED', currentMatchId: null };

/** The tables of a migrated file, as the v2 schema sees them. */
function migratedTables(file: Record<string, unknown>): unknown[] {
  const tables = v1ToV2.migrate(file)['tables'];
  return Array.isArray(tables) ? tables : [];
}

describe('v1 → v2', () => {
  it('announces the step it takes', () => {
    expect(v1ToV2).toMatchObject({ from: 1, to: 2 });
  });

  /*
   * `updatedAt` is later than the true start, which is the safe direction: the
   * board under-reports rather than inventing a match that has apparently been
   * running all morning.
   */
  it('dates a busy table from the last thing that happened in the file', () => {
    const [busy] = migratedTables(v1File([OCCUPIED]));

    expect(busy).toEqual({ ...OCCUPIED, occupiedSince: UPDATED_AT });
  });

  it('leaves a free table free, with no stamp', () => {
    expect(migratedTables(v1File([FREE, DISABLED]))).toEqual([
      { ...FREE, occupiedSince: null },
      { ...DISABLED, occupiedSince: null },
    ]);
  });

  /*
   * v1 could express a table that calls itself busy while naming no match; v2
   * cannot. It comes back free, because a free table the host marks busy again
   * costs one click while a busy table that is really free holds up the queue
   * for the rest of the event.
   */
  it('frees a table that claimed to be busy without naming a match', () => {
    const [repaired] = migratedTables(
      v1File([{ id: 'tbl_1', label: 'Tisch 1', status: 'OCCUPIED', currentMatchId: null }]),
    );

    expect(repaired).toMatchObject({ status: 'FREE', currentMatchId: null, occupiedSince: null });
  });

  /* A table out of service is a decision the host took about the furniture, not
   * a claim about a match, so it survives the repair. */
  it('keeps a table out of service out of service', () => {
    const [repaired] = migratedTables(
      v1File([{ ...DISABLED, currentMatchId: 'mt_9' }].map((entry) => ({ ...entry }))),
    );

    expect(repaired).toMatchObject({ status: 'DISABLED', currentMatchId: null });
  });

  it('produces tables the v2 schema accepts', () => {
    for (const entry of migratedTables(v1File([OCCUPIED, FREE, DISABLED]))) {
      expect(tableSchema.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
    }
  });

  it('leaves everything that is not a table alone', () => {
    const migrated = v1ToV2.migrate(v1File([FREE]));

    expect(migrated['name']).toBe('Vereinsturnier');
    expect(migrated['updatedAt']).toBe(UPDATED_AT);
  });

  it('does not mutate the file it was given', () => {
    const file = v1File([OCCUPIED]);
    const before = JSON.stringify(file);

    v1ToV2.migrate(file);

    expect(JSON.stringify(file)).toBe(before);
  });

  /*
   * A refusal rather than a guess: there is nothing else in the file that says
   * when the match on that table began (`Migration.migrate`).
   */
  it('refuses a busy table in a file with no usable updatedAt', () => {
    expect(() => v1ToV2.migrate({ schemaVersion: 1, tables: [OCCUPIED] })).toThrow();
  });

  it('does not need updatedAt when no table is busy', () => {
    expect(() => v1ToV2.migrate({ schemaVersion: 1, tables: [FREE] })).not.toThrow();
  });

  /*
   * Handed on untouched so the schema reports it, with a path, rather than this
   * step failing with "the file could not be brought up to date".
   */
  it.each([
    ['missing', undefined],
    ['not an array', 'Tisch 1'],
  ])('passes a tables field that is %s straight through', (_case, tables) => {
    const file = { schemaVersion: 1, updatedAt: UPDATED_AT, tables };

    expect(v1ToV2.migrate(file)).toEqual(file);
  });

  it('passes a table entry that is not an object straight through', () => {
    expect(migratedTables(v1File([null, 'Tisch 1']))).toEqual([null, 'Tisch 1']);
  });

  /*
   * v2's table-number counter. v1 derived the number from the tables it had, so
   * the reconstruction is the highest `tbl_<n>` the file still mentions — and it
   * has to look past `tables`, or a file whose highest table was deleted before
   * it was saved hands that number back out to a new one (OPEN-QUESTIONS #37).
   */
  describe('nextTableNumber', () => {
    it('counts on from the highest table in the file', () => {
      expect(v1ToV2.migrate(v1File([OCCUPIED, FREE, DISABLED]))['nextTableNumber']).toBe(4);
    });

    it('counts on from a match played on a table that is gone', () => {
      const file = {
        ...v1File([FREE]),
        rounds: [
          { id: 'rnd_1', state: 'CLOSED', matches: [{ id: 'mt_1', tableId: 'tbl_7' }] },
          { id: 'rnd_2', state: 'DRAWN', matches: [{ id: 'mt_2', tableId: null }] },
        ],
      };

      expect(v1ToV2.migrate(file)['nextTableNumber']).toBe(8);
    });

    it('counts on from a bracket node pointing at a table that is gone', () => {
      const file = {
        ...v1File([FREE]),
        bracket: { size: 4, nodes: [{ id: 'bn_1', tableId: 'tbl_5' }, { id: 'bn_2' }] },
      };

      expect(v1ToV2.migrate(file)['nextTableNumber']).toBe(6);
    });

    it('starts at one for a file with no table anywhere', () => {
      expect(v1ToV2.migrate(v1File([]))['nextTableNumber']).toBe(1);
    });

    /* A hand-repaired file must lose one number, not the whole tournament. */
    it.each([
      ['a round in an unexpected shape', { rounds: ['Runde 1', null, { matches: 'mt_1' }] }],
      ['a bracket in an unexpected shape', { bracket: 'Turnierbaum' }],
      ['an id that does not follow the scheme', { rounds: [{ matches: [{ tableId: 'hinten' }] }] }],
    ])('survives %s', (_case, extra) => {
      const file = { ...v1File([FREE]), ...extra };

      expect(() => v1ToV2.migrate(file)).not.toThrow();
      expect(v1ToV2.migrate(file)['nextTableNumber']).toBe(3);
    });
  });
});
