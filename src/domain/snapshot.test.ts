import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/domain/factory';
import { groupIdSchema } from '@/domain/ids';
import {
  INITIAL_SNAPSHOT,
  snapshotSchema,
  supersedes,
  toTournamentSnapshot,
  type Snapshot,
} from '@/domain/snapshot';
import {
  group,
  match,
  matchId,
  midTournament,
  occupiedTable,
  roundId,
  table,
  tournament,
} from '@/domain/testFixtures';

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...INITIAL_SNAPSHOT, ...overrides };
}

describe('the snapshot envelope', () => {
  it('survives a round trip through the wire format', () => {
    const sent = snapshot({
      revision: 7,
      scene: { id: 'BRACKET' },
      tournament: {
        name: 'Sommerturnier',
        participantLabel: 'TEAM',
        performanceMode: true,
        groups: [
          {
            id: groupIdSchema.parse('g1'),
            number: 1,
            name: 'Die Rasenden',
            status: 'ACTIVE',
          },
        ],
        // Tables and the match on one of them travel the same wire (issue #13);
        // a `null` that came back as `undefined` would be a table the beamer
        // draws as busy for the rest of the event.
        tables: [occupiedTable(1, matchId(4)), table(2, { status: 'DISABLED' })],
        matches: [match(4, { tableId: table(1).id, status: 'RUNNING' })],
        round: null,
        repechage: null,
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

    expect(toTournamentSnapshot(tournament({ groups })).groups).toEqual(groups);
  });

  /** Issue #13: the beamer draws the occupancy board from what it is sent. */
  it('sends the tables in the order the host arranged them', () => {
    const tables = [table(3), table(1), table(2, { status: 'DISABLED' })];

    expect(toTournamentSnapshot(tournament({ tables })).tables).toEqual(tables);
  });

  /*
   * Widened by issue #18 from "the matches on a table" to the whole current
   * round: the draw scene has to show every pairing it deals, including the
   * ones queued for a table and the byes, which never touch one.
   */
  it('sends the whole current round, not only what is on a table', () => {
    const projected = toTournamentSnapshot(midTournament());

    // `midTournament`'s open round has two matches, one of them on a table.
    expect(projected.matches.map((entry) => entry.id)).toEqual([matchId(1), matchId(3)]);
    expect(projected.round?.id).toBe(roundId(2));
  });

  /*
   * A match of a *closed* round must not travel: the beamer would draw a
   * pairing that is over as though it were still to be played.
   */
  it('leaves the matches of a closed round behind', () => {
    const projected = toTournamentSnapshot(midTournament());

    expect(projected.matches.map((entry) => entry.id)).not.toContain(matchId(2));
  });

  /*
   * Between two rounds there is no round to send, and what is still on a table
   * is what the occupancy board has to keep drawing.
   */
  it('falls back to the tables when no round is open', () => {
    const between = midTournament({
      rounds: midTournament().rounds.map((entry) => ({ ...entry, state: 'CLOSED' as const })),
    });
    const projected = toTournamentSnapshot(between);

    expect(projected.round).toBeNull();
    expect(projected.matches.map((entry) => entry.id)).toEqual([matchId(1)]);
  });

  /* The round travels without its matches — one list, so the two halves of a
   * snapshot cannot disagree about which pairing is on which table. */
  it('sends the round without duplicating its matches', () => {
    const projected = toTournamentSnapshot(midTournament());
    expect(projected.round).not.toHaveProperty('matches');
  });

  /*
   * docs/MOTION.md §6 requires performance mode to reach a beamer window that is
   * already showing something, so it travels in the snapshot rather than being
   * read from a preference file the projector would only see on a reload
   * (issue #15).
   */
  it('tells the beamer how expensively it may animate', () => {
    const cheap = tournament({ settings: { ...DEFAULT_SETTINGS, performanceMode: true } });

    expect(toTournamentSnapshot(cheap).performanceMode).toBe(true);
    expect(toTournamentSnapshot(tournament()).performanceMode).toBe(false);
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

    expect(Object.keys(projected).sort()).toEqual([
      'groups',
      'matches',
      'name',
      'participantLabel',
      'performanceMode',
      'repechage',
      'round',
      'tables',
    ]);
    expect(snapshotSchema.safeParse(snapshot({ tournament: projected })).success).toBe(true);
  });

  it('projects an empty tournament as an empty picture', () => {
    expect(toTournamentSnapshot(tournament())).toEqual({
      name: 'Test Tournament',
      groups: [],
      participantLabel: 'GROUP',
      performanceMode: false,
      tables: [],
      matches: [],
      round: null,
      repechage: null,
    });
  });
});
