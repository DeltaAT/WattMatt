import { describe, expect, it } from 'vitest';

import { v6ToV7 } from '@/domain/migrations/v6_to_v7';

/**
 * v6 → v7: the `Trostrunde` runs the whole pipeline (issue #91,
 * docs/TOURNAMENT-RULES.md §10, docs/OPEN-QUESTIONS.md #99).
 *
 * The side event gains the same three pieces of state the main field has —
 * where it stands, its own `Hoffnungsrunde`, its own tree. What is checked here
 * is that a v6 file comes back at the point a host can still act on, and that
 * nothing else in the file is touched on the way.
 */

function v6File(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 6,
    name: 'Vereinsturnier',
    phase: 'ELIMINATION',
    consolation: { state: 'RUNNING', winnerId: null },
    ...overrides,
  };
}

describe('v6ToV7', () => {
  it('steps one version', () => {
    expect(v6ToV7.from).toBe(6);
    expect(v6ToV7.to).toBe(7);
  });

  /*
   * `QUALIFYING`, and not a guess at `ELIMINATION` from the number of rounds
   * played: a v6 side event has rounds but no lottery and no tree, which is
   * exactly where the new rules put a track at `QUALIFYING`. Guessing further
   * along would carry a reopened event *past* the `Hoffnungsrunde` it is now
   * entitled to — and that lottery is the one part of this that hands somebody
   * back a place (docs/OPEN-QUESTIONS.md #99).
   */
  it('brings a running side event back at the start of its own pipeline', () => {
    const migrated = v6ToV7.migrate(v6File());

    expect(migrated['consolation']).toEqual({
      state: 'RUNNING',
      winnerId: null,
      phase: 'QUALIFYING',
      repechage: null,
      bracket: null,
    });
  });

  /*
   * Null rather than an empty lottery or an empty tree: the build that wrote
   * the file could not produce either, so null is the literal truth about it.
   */
  it('gives it no lottery and no tree, because the file has neither', () => {
    const consolation = v6ToV7.migrate(v6File())['consolation'] as Record<string, unknown>;

    expect(consolation['repechage']).toBeNull();
    expect(consolation['bracket']).toBeNull();
  });

  /*
   * A finished v6 event keeps the two fields every panel actually reads. The
   * phase written beside them is never consulted for it, because nothing is
   * offered for a track that is no longer running.
   */
  it('leaves a finished side event’s answer intact', () => {
    const before = v6File({ consolation: { state: 'FINISHED', winnerId: 'grp_7' } });
    const consolation = v6ToV7.migrate(before)['consolation'] as Record<string, unknown>;

    expect(consolation['state']).toBe('FINISHED');
    expect(consolation['winnerId']).toBe('grp_7');
  });

  it('leaves a declined side event’s answer intact', () => {
    const before = v6File({ consolation: { state: 'DECLINED', winnerId: null } });
    const consolation = v6ToV7.migrate(before)['consolation'] as Record<string, unknown>;

    expect(consolation['state']).toBe('DECLINED');
  });

  /* A host who was never asked has nothing to bring forward. */
  it('hands back a tournament with no side event at all', () => {
    const before = v6File({ consolation: null });

    expect(v6ToV7.migrate(before)).toEqual(before);
  });

  it('leaves every other field of the file alone', () => {
    const before = v6File({ rngSeed: 'seed', nextGroupNumber: 17 });
    const migrated = v6ToV7.migrate(before);

    expect(migrated['name']).toBe('Vereinsturnier');
    expect(migrated['phase']).toBe('ELIMINATION');
    expect(migrated['rngSeed']).toBe('seed');
    expect(migrated['nextGroupNumber']).toBe(17);
  });

  /*
   * docs/FILE-FORMAT.md §Encoding invites a repair in Notepad, and a host who
   * wrote a field in by hand meant it. Evidence in the file beats a
   * reconstruction — the same rule `v3ToV4` and `v4ToV5` follow.
   */
  it('keeps a phase a hand-repaired file already carries', () => {
    const before = v6File({
      consolation: { state: 'RUNNING', winnerId: null, phase: 'BRACKET' },
    });
    const consolation = v6ToV7.migrate(before)['consolation'] as Record<string, unknown>;

    expect(consolation['phase']).toBe('BRACKET');
    // And the two it does not carry are still filled in.
    expect(consolation['repechage']).toBeNull();
    expect(consolation['bracket']).toBeNull();
  });

  /*
   * A `consolation` that is not an object is handed on untouched, so the schema
   * reports it with a path rather than this step failing with "could not be
   * brought up to date" — which tells the host nothing about which line to look
   * at.
   */
  it.each([['RUNNING'], [7], [['RUNNING']]])(
    'hands on a consolation that is not an object: %s',
    (broken) => {
      const before = v6File({ consolation: broken });

      expect(v6ToV7.migrate(before)).toEqual(before);
    },
  );
});
