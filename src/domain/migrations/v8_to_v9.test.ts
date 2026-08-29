import { describe, expect, it } from 'vitest';

import { settleConsolationField } from '@/domain/consolation';
import { v8ToV9 } from '@/domain/migrations/v8_to_v9';
import { midTournament } from '@/domain/testFixtures';

/**
 * v8 → v9: the `Trostrunde`'s field is written down rather than worked out
 * (issue #102, docs/TOURNAMENT-RULES.md §10).
 *
 * The step itself is one field, and it deliberately does **not** reconstruct.
 * What is worth checking is therefore the pair of claims that makes that safe:
 * `null` really does mean "not fixed yet" rather than "no field", and the file
 * a v8 build wrote still carries everything the app needs to fix it on the next
 * commit — which is what the last test walks.
 */

function v8File(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 8,
    name: 'Vereinsturnier',
    rounds: [{ id: 'rnd_1', kind: 'QUALIFYING', track: 'MAIN', state: 'CLOSED', matches: [] }],
    consolation: null,
    ...fields,
  };
}

describe('v8ToV9', () => {
  it('steps one version', () => {
    expect(v8ToV9.from).toBe(8);
    expect(v8ToV9.to).toBe(9);
  });

  /*
   * Null rather than a reconstruction, and null is a real answer: the field is
   * not fixed yet. Deriving one here would have to answer "has the lottery
   * closed?" first, and a file saved mid-`Hoffnungsrunde` would freeze a field
   * with the candidates still to be drawn wrongly inside it.
   */
  it('brings a file back with no field fixed', () => {
    const migrated = v8ToV9.migrate(v8File());

    expect(migrated['consolationField']).toBeNull();
    expect('consolationField' in migrated).toBe(true);
  });

  it('leaves every other field of the file exactly as it found it', () => {
    const before = v8File();

    const migrated = v8ToV9.migrate(before);

    expect(migrated['name']).toBe('Vereinsturnier');
    expect(migrated['rounds']).toEqual(before['rounds']);
    expect(migrated['consolation']).toBeNull();
    expect(migrated['schemaVersion']).toBe(8);
  });

  /*
   * Evidence in the file beats a reconstruction — the rule `v3ToV4` follows
   * about the pool and `v7ToV8` about the table order. A file that explicitly
   * says `null` has been through this step already, and writing over it would
   * be writing over an answer.
   */
  it.each([
    ['a list a hand-repaired file carries', ['grp_3']],
    ['a null it already carries', null],
  ])('keeps %s', (_case, field) => {
    const before = v8File({ consolationField: field });

    expect(v8ToV9.migrate(before)).toBe(before);
  });

  /*
   * The claim the step rests on: nothing is lost by waiting. A v8 file's
   * qualifying round and lottery records are untouched by the migration, so the
   * first commit after it is opened writes exactly the list the build that
   * wrote the file would have.
   *
   * `midTournament` is that file: its round 1 is closed, group 3 lost it and
   * then declined its second chance, and the lottery is over.
   */
  it('leaves a file the app can fix on its next commit', () => {
    const opened = { ...midTournament(), consolationField: null };

    const settled = settleConsolationField(opened);

    expect(settled.consolationField).toEqual(midTournament().consolationField);
  });
});
