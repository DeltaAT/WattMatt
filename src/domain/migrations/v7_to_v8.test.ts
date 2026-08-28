import { describe, expect, it } from 'vitest';

import { v7ToV8 } from '@/domain/migrations/v7_to_v8';

/**
 * v7 → v8: the host chooses which end of the table list is filled first
 * (issue #101, docs/TOURNAMENT-RULES.md §3).
 *
 * The whole of the step is one field on `settings`, so what is worth checking
 * is the reconstruction behind it — `ASCENDING` is not a default picked for
 * being harmless, it is what the build that wrote the file actually did — and
 * that nothing else in the file moves on the way.
 */

function v7File(settings: unknown = {}): Record<string, unknown> {
  return {
    schemaVersion: 7,
    name: 'Vereinsturnier',
    tables: [{ id: 'tbl_1', label: 'Tisch 1' }],
    settings: settings as Record<string, unknown>,
  };
}

describe('v7ToV8', () => {
  it('steps one version', () => {
    expect(v7ToV8.from).toBe(7);
    expect(v7ToV8.to).toBe(8);
  });

  /*
   * The reconstruction. A v7 build could only fill from the front of the list,
   * so every table that file ever handed out was handed out ascending —
   * `ASCENDING` is the literal truth about that evening rather than a guess.
   */
  it('brings a file back filling from the first table', () => {
    const migrated = v7ToV8.migrate(v7File({ participantLabel: 'GROUP', namingAt: 16 }));

    expect(migrated['settings']).toEqual({
      participantLabel: 'GROUP',
      namingAt: 16,
      tableAssignmentOrder: 'ASCENDING',
    });
  });

  it('leaves every other field of the file exactly as it found it', () => {
    const before = v7File({ namingAt: 8 });

    const migrated = v7ToV8.migrate(before);

    expect(migrated['name']).toBe('Vereinsturnier');
    expect(migrated['tables']).toEqual(before['tables']);
    expect(migrated['schemaVersion']).toBe(7);
  });

  /*
   * Evidence in the file beats a reconstruction, and docs/FILE-FORMAT.md
   * §Encoding invites the repair — the same rule `v3ToV4` follows about the
   * pool and `v5ToV6` about the reservation.
   */
  it('keeps a direction a hand-repaired file already carries', () => {
    const migrated = v7ToV8.migrate(v7File({ tableAssignmentOrder: 'DESCENDING' }));

    expect(migrated['settings']).toEqual({ tableAssignmentOrder: 'DESCENDING' });
  });

  /*
   * A `settings` that is not an object is handed on untouched, so the schema
   * reports it with a path rather than this step failing with "could not be
   * brought up to date" — the argument `v4ToV5` makes about a round that is
   * not one.
   */
  it.each([['not an object', 'ASCENDING'] as const, ['missing', undefined] as const])(
    'hands on a file whose settings is %s',
    (_case, settings) => {
      const before = { schemaVersion: 7, settings };

      expect(v7ToV8.migrate(before)).toBe(before);
    },
  );

  it('hands on a settings that is an array rather than an object', () => {
    const before = { schemaVersion: 7, settings: [] };

    expect(v7ToV8.migrate(before)).toBe(before);
  });
});
