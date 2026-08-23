import { describe, expect, it } from 'vitest';

import { groupIdSchema } from '@/domain/ids';
import {
  INITIAL_SNAPSHOT,
  snapshotSchema,
  supersedes,
  toTournamentSnapshot,
  type Snapshot,
} from '@/domain/snapshot';
import { group, table, tournament } from '@/domain/testFixtures';

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...INITIAL_SNAPSHOT, ...overrides };
}

describe('the snapshot envelope', () => {
  it('survives a round trip through the wire format', () => {
    const sent = snapshot({
      revision: 7,
      scene: { id: 'BRACKET' },
      tournament: {
        groups: [
          {
            id: groupIdSchema.parse('g1'),
            number: 1,
            name: 'Die Rasenden',
            status: 'ACTIVE',
          },
        ],
      },
      delivery: 'live',
    });

    // This is the actual boundary: a payload leaves as JSON and must come back
    // as the same value, not merely as something that parses.
    const received = snapshotSchema.parse(JSON.parse(JSON.stringify(sent)));

    expect(received).toEqual(sent);
  });

  it('rejects a payload whose scene is not a scene', () => {
    const broken = { ...INITIAL_SNAPSHOT, scene: { id: 'NOPE' } };
    expect(snapshotSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a negative or fractional revision', () => {
    expect(snapshotSchema.safeParse(snapshot({ revision: -1 })).success).toBe(false);
    expect(snapshotSchema.safeParse(snapshot({ revision: 1.5 })).success).toBe(false);
  });
});

describe('supersedes', () => {
  it('accepts a newer revision', () => {
    expect(supersedes(snapshot({ revision: 4 }), snapshot({ revision: 3 }))).toBe(true);
  });

  it('drops one that lost a race', () => {
    // Out-of-order delivery would otherwise walk the beamer backwards into a
    // round that has already finished.
    expect(supersedes(snapshot({ revision: 2 }), snapshot({ revision: 3 }))).toBe(false);
  });

  it('accepts an equal revision, because that is what a catch-up answer is', () => {
    expect(supersedes(snapshot({ revision: 3 }), snapshot({ revision: 3 }))).toBe(true);
  });
});

describe('toTournamentSnapshot', () => {
  it('hands the beamer the real groups, not a parallel copy of them', () => {
    const groups = [group(1), group(2, { name: 'Die Schnellen' })];

    expect(toTournamentSnapshot(tournament({ groups }))).toEqual({ groups });
  });

  /**
   * The projection is what the beamer renders, and it carries only what a scene
   * draws today (docs/OPEN-QUESTIONS.md #19). Sending the whole tournament would
   * put the draw order of a round on the projector's side of the wall before any
   * scene has decided how to show it.
   */
  it('sends nothing the snapshot schema has not declared', () => {
    const projected = toTournamentSnapshot(
      tournament({ groups: [group(1)], tables: [table(1)], rngSeed: 'secret' }),
    );

    expect(Object.keys(projected)).toEqual(['groups']);
    expect(snapshotSchema.safeParse(snapshot({ tournament: projected })).success).toBe(true);
  });

  it('projects an empty tournament as an empty picture', () => {
    expect(toTournamentSnapshot(tournament())).toEqual({ groups: [] });
  });
});
