import { describe, expect, it } from 'vitest';

import { v5ToV6 } from '@/domain/migrations/v5_to_v6';

/**
 * v5 → v6: `table.reservedFor` (issue #79, docs/TOURNAMENT-RULES.md §10).
 */

function v5File(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 5,
    name: 'Vereinsturnier',
    tables: [
      {
        id: 'tbl_1',
        label: 'Tisch 1',
        status: 'OCCUPIED',
        currentMatchId: 'mt_4',
        occupiedSince: '2026-08-23T19:12:00+02:00',
      },
      { id: 'tbl_2', label: 'Tisch 2', status: 'FREE', currentMatchId: null, occupiedSince: null },
      {
        id: 'tbl_3',
        label: 'Fenster',
        status: 'DISABLED',
        currentMatchId: null,
        occupiedSince: null,
      },
    ],
    ...overrides,
  };
}

describe('v5ToV6', () => {
  it('steps one version', () => {
    expect(v5ToV6.from).toBe(5);
    expect(v5ToV6.to).toBe(6);
  });

  /*
   * Not a default: a v5 file was written by a build in which no table could be
   * reserved, so every table in it served both tracks. Null says exactly that,
   * and a migration that guessed `MAIN` would quietly lock the `Trostrunde` out
   * of every table in a reopened file.
   */
  it('brings every table back serving both tracks', () => {
    const migrated = v5ToV6.migrate(v5File());

    expect(migrated['tables']).toEqual([
      expect.objectContaining({ id: 'tbl_1', reservedFor: null }),
      expect.objectContaining({ id: 'tbl_2', reservedFor: null }),
      expect.objectContaining({ id: 'tbl_3', reservedFor: null }),
    ]);
  });

  it('leaves every other field of a table alone', () => {
    const migrated = v5ToV6.migrate(v5File());
    const table = (migrated['tables'] as Record<string, unknown>[])[0];

    expect(table).toEqual({
      id: 'tbl_1',
      label: 'Tisch 1',
      status: 'OCCUPIED',
      currentMatchId: 'mt_4',
      occupiedSince: '2026-08-23T19:12:00+02:00',
      reservedFor: null,
    });
  });

  it('leaves every other field of the file alone', () => {
    const before = v5File({ rngSeed: 'seed', nextTableNumber: 4 });
    const migrated = v5ToV6.migrate(before);

    expect(migrated['name']).toBe('Vereinsturnier');
    expect(migrated['rngSeed']).toBe('seed');
    expect(migrated['nextTableNumber']).toBe(4);
  });

  /*
   * docs/FILE-FORMAT.md §Encoding invites a repair in Notepad, and a host who
   * wrote the field in by hand meant it. Evidence in the file beats a
   * reconstruction.
   */
  it('keeps a reservation a hand-repaired file already carries', () => {
    const before = v5File({
      tables: [
        {
          id: 'tbl_1',
          label: 'Tisch 1',
          status: 'FREE',
          currentMatchId: null,
          occupiedSince: null,
          reservedFor: 'CONSOLATION',
        },
      ],
    });

    expect((v5ToV6.migrate(before)['tables'] as Record<string, unknown>[])[0]).toEqual(
      expect.objectContaining({ reservedFor: 'CONSOLATION' }),
    );
  });

  /*
   * A `tables` that is not an array, or a table that is not an object, is
   * handed on untouched so the schema reports it with a path — rather than this
   * step failing with "could not be brought up to date", which tells the host
   * nothing about which line to look at.
   */
  it('hands on a file whose tables are not a list', () => {
    const broken = v5File({ tables: 'tbl_1' });

    expect(v5ToV6.migrate(broken)).toEqual(broken);
  });

  it('hands on a table that is not an object', () => {
    const broken = v5File({ tables: [null, 'tbl_2', 7] });

    expect(v5ToV6.migrate(broken)['tables']).toEqual([null, 'tbl_2', 7]);
  });
});
