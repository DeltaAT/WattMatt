import { describe, expect, it } from 'vitest';

import { queuedMatches } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { currentRound } from '@/domain/selectors';
import {
  FIXED_NOW,
  fixedClock,
  group,
  groupId,
  match,
  round,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import { tournamentSchema, type Round, type Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { closeRound, drawRound, setMatchWinner, startNextMatch } from '@/store/actions/round';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The round actions (issue #17).
 *
 * The rules are `@/domain/draw`'s and are tested there. What is checked here is
 * what an action adds: the German step the undo button reads, the audit entry
 * the file keeps, the beamer picture that travels with a draw, and the two
 * things `change` refuses to do — commit with no tournament open, and commit a
 * change that changed nothing.
 */

const CLOCK = fixedClock();

/** A tournament in `QUALIFYING` with `groups` participants and `tables` tables. */
function ready(groups = 6, tables = 2, overrides: Partial<Tournament> = {}): Tournament {
  return tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
    ...overrides,
  });
}

function setup(document: Tournament = ready()): TournamentStore {
  return createTournamentStore(
    { ...INITIAL_TOURNAMENT_STATE, document, file: { status: 'saved', path: 'C:\\T.wattmatt' } },
    { clock: CLOCK },
  );
}

const documentOf = (store: TournamentStore): Tournament => {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

const openRound = (store: TournamentStore): Round => {
  const open = currentRound(documentOf(store));
  if (open === null) {
    throw new Error('no open round');
  }
  return open;
};

const lastLog = (store: TournamentStore) => documentOf(store).log.at(-1);

/**
 * A tournament without the two streams an undo deliberately does not rewind:
 * the log is append-only and records the undo itself, and the RNG cursor only
 * ever moves forward so a redraw cannot repeat pairings the room has seen
 * (`@/store/undo`).
 */
function restorable({ log: _log, updatedAt: _updatedAt, rngCursor: _cursor, ...rest }: Tournament) {
  return rest;
}

const restored = (store: TournamentStore) => restorable(documentOf(store));

describe('drawRound', () => {
  it('draws the round, fills the tables and stages it on the beamer in one commit', () => {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);

    const drawn = openRound(store);
    expect(drawn.label).toBe(de.round.title({ n: 1 }));
    expect(drawn.matches).toHaveLength(3);
    expect(documentOf(store).tables.filter((each) => each.status === 'OCCUPIED')).toHaveLength(2);

    // One commit, so one undo takes back both the pairings and the picture.
    expect(store.getState().scene).toEqual({ id: 'DRAW', roundId: drawn.id });
  });

  it('names the round on the undo button and records the draw in the log', () => {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.roundDrawn({ round: de.round.title({ n: 1 }) }),
    );

    const entry = lastLog(store);
    expect(entry?.action).toBe('ROUND_DRAWN');
    expect(entry?.payload.roundId).toBe(openRound(store).id);
    // The cursor the draw ran from is what makes a disputed pairing
    // reproducible a week later (CLAUDE.md golden rule 7).
    expect(entry?.payload.rngCursor).toBe(documentOf(store).rngCursor);
  });

  it('takes the round and the beamer back together on undo', () => {
    const store = setup();
    const before = restored(store);
    const scene = store.getState().scene;

    drawRound(store, 'MAIN', CLOCK);
    store.undo();

    expect(restored(store)).toEqual(before);
    expect(store.getState().scene).toEqual(scene);
  });

  it('does nothing while a round is still open', () => {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);
    const revision = store.getState().revision;

    drawRound(store, 'MAIN', CLOCK);

    expect(store.getState().revision).toBe(revision);
    expect(documentOf(store).rounds).toHaveLength(1);
  });

  it('does nothing with no tournament open', () => {
    const store = createTournamentStore(INITIAL_TOURNAMENT_STATE, { clock: CLOCK });
    drawRound(store, 'MAIN', CLOCK);
    expect(store.getState().revision).toBe(0);
  });

  it('leaves a tournament that is valid against the schema', () => {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);
    expect(() => tournamentSchema.parse(documentOf(store))).not.toThrow();
  });
});

describe('setMatchWinner', () => {
  /** A drawn round with its first match on table 1. */
  function drawn(): TournamentStore {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);
    return store;
  }

  const firstMatch = (store: TournamentStore) => {
    const first = openRound(store).matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    return first;
  };

  it('marks the winner, frees the table and names the participant on the undo button', () => {
    const store = drawn();
    const decided = firstMatch(store);
    const winnerId = decided.a;

    setMatchWinner(store, decided.id, winnerId);

    const after = documentOf(store);
    expect(currentRound(after)?.matches[0]?.winnerId).toBe(winnerId);
    // docs/TOURNAMENT-RULES.md §3: marking a winner is what frees the table.
    expect(after.tables.find((each) => each.id === tableId(1))?.status).toBe('FREE');
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchWinnerSet({ participant: participantOf(after, winnerId) }),
    );
  });

  it('records the result, with no previous winner the first time', () => {
    const store = drawn();
    const decided = firstMatch(store);

    setMatchWinner(store, decided.id, decided.a);

    expect(lastLog(store)?.action).toBe('MATCH_WINNER_SET');
    expect(lastLog(store)?.payload).toMatchObject({
      matchId: decided.id,
      winnerId: decided.a,
      previousWinnerId: null,
    });
  });

  it('reads a correction as a correction, on the button and in the log', () => {
    const store = drawn();
    const decided = firstMatch(store);
    const b = decided.b;
    if (b === null) {
      throw new Error('the first match is a bye');
    }

    setMatchWinner(store, decided.id, decided.a);
    setMatchWinner(store, decided.id, b);

    const after = documentOf(store);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchWinnerCorrected({ participant: participantOf(after, b) }),
    );
    expect(lastLog(store)?.payload.previousWinnerId).toBe(decided.a);
    // The corrected loser is back in, the new one is out (§9 case 8).
    expect(after.groups.find((each) => each.id === b)?.status).toBe('ACTIVE');
    expect(after.groups.find((each) => each.id === decided.a)?.status).toBe('ELIMINATED');
  });

  it('does nothing for a bye, which the draw already decided', () => {
    // Five groups: two pairs and a leftover that advances without playing.
    const store = setup(ready(5, 2));
    drawRound(store, 'MAIN', CLOCK);
    const bye = openRound(store).matches.find((each) => each.b === null);
    if (bye === undefined) {
      throw new Error('no bye was drawn');
    }
    const revision = store.getState().revision;

    setMatchWinner(store, bye.id, bye.a);

    expect(store.getState().revision).toBe(revision);
  });

  it('does nothing for a group that is not in the match', () => {
    const store = drawn();
    const decided = firstMatch(store);
    const outsider = documentOf(store).groups.find(
      (each) => each.id !== decided.a && each.id !== decided.b,
    );
    const revision = store.getState().revision;

    setMatchWinner(store, decided.id, outsider?.id ?? groupId(99));

    expect(store.getState().revision).toBe(revision);
  });

  it('restores the previous result exactly on undo', () => {
    const store = drawn();
    const decided = firstMatch(store);
    const b = decided.b;
    if (b === null) {
      throw new Error('the first match is a bye');
    }

    setMatchWinner(store, decided.id, decided.a);
    const afterFirst = restored(store);

    setMatchWinner(store, decided.id, b);
    store.undo();

    expect(restored(store)).toEqual(afterFirst);
  });
});

describe('startNextMatch', () => {
  /** Eight groups on one table: three pairs are waiting from the first second. */
  function queued(): TournamentStore {
    const store = setup(ready(8, 1));
    drawRound(store, 'MAIN', CLOCK);
    return store;
  }

  it('puts the front of the queue on the freed table and names it on the undo button', () => {
    const store = queued();
    const running = openRound(store).matches[0];
    const waiting = queuedMatches(openRound(store))[0];
    if (running === undefined || waiting === undefined) {
      throw new Error('nothing was drawn');
    }

    setMatchWinner(store, running.id, running.a);
    startNextMatch(store, tableId(1), 'MAIN', CLOCK);

    const after = documentOf(store);
    expect(after.tables[0]?.currentMatchId).toBe(waiting.id);
    expect(after.tables[0]?.occupiedSince).toBe(FIXED_NOW);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchStarted({ table: after.tables[0]?.label ?? '' }),
    );
    expect(lastLog(store)?.action).toBe('MATCH_ASSIGNED');
    expect(lastLog(store)?.payload).toMatchObject({ tableId: tableId(1), matchId: waiting.id });
  });

  it('records how long the queue was before the pair walked up', () => {
    const store = queued();
    const running = openRound(store).matches[0];
    if (running === undefined) {
      throw new Error('nothing was drawn');
    }

    setMatchWinner(store, running.id, running.a);
    startNextMatch(store, tableId(1), 'MAIN', CLOCK);

    expect(lastLog(store)?.payload.queued).toBe(3);
  });

  it('does nothing while the table is still busy', () => {
    const store = queued();
    const revision = store.getState().revision;

    startNextMatch(store, tableId(1), 'MAIN', CLOCK);

    expect(store.getState().revision).toBe(revision);
  });

  it('does nothing with an empty queue', () => {
    const store = setup(ready(4, 2));
    drawRound(store, 'MAIN', CLOCK);
    const running = openRound(store).matches[0];
    if (running === undefined) {
      throw new Error('nothing was drawn');
    }
    setMatchWinner(store, running.id, running.a);
    const revision = store.getState().revision;

    startNextMatch(store, tableId(1), 'MAIN', CLOCK);

    expect(store.getState().revision).toBe(revision);
  });
});

describe('closeRound', () => {
  it('does nothing while a match has no winner', () => {
    const store = setup();
    drawRound(store, 'MAIN', CLOCK);
    const revision = store.getState().revision;

    closeRound(store);

    expect(store.getState().revision).toBe(revision);
    expect(openRound(store).state).not.toBe('CLOSED');
  });

  it('closes the round and records who is through and who is out', () => {
    const store = setup(ready(4, 2));
    drawRound(store, 'MAIN', CLOCK);
    const matches = openRound(store).matches;
    const closing = openRound(store);
    for (const each of matches) {
      setMatchWinner(store, each.id, each.a);
    }

    closeRound(store);

    expect(currentRound(documentOf(store))).toBeNull();
    expect(documentOf(store).rounds[0]?.state).toBe('CLOSED');

    const entry = lastLog(store);
    expect(entry?.action).toBe('ROUND_CLOSED');
    expect(entry?.payload).toMatchObject({
      roundId: closing.id,
      winners: matches.map((each) => each.a),
      losers: matches.map((each) => each.b),
    });
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.roundClosed({ round: closing.label }),
    );
  });

  it('reopens the round exactly as it was on undo', () => {
    const store = setup(ready(4, 2));
    drawRound(store, 'MAIN', CLOCK);
    for (const each of openRound(store).matches) {
      setMatchWinner(store, each.id, each.a);
    }
    const before = restored(store);

    closeRound(store);
    store.undo();

    expect(restored(store)).toEqual(before);
  });

  it('frees a table a decided match was still sitting on', () => {
    // A match decided through an older path — a file loaded mid-round, or a
    // table handed the match back — must not leave the round holding a table.
    const stranded = match(1, {
      tableId: tableId(1),
      a: groupId(1),
      b: groupId(2),
      winnerId: groupId(1),
      status: 'DONE',
    });
    const store = setup(
      ready(2, 1, {
        tables: [
          {
            id: tableId(1),
            label: 'Tisch 1',
            status: 'OCCUPIED',
            currentMatchId: stranded.id,
            occupiedSince: FIXED_NOW,
            reservedFor: null,
          },
        ],
        rounds: [round(1, { state: 'RUNNING', matches: [stranded] })],
      }),
    );

    closeRound(store);

    expect(documentOf(store).tables[0]?.status).toBe('FREE');
  });
});

/** What the tournament calls a group, the way the action's label does. */
function participantOf(document: Tournament, id: GroupId): string {
  const found = document.groups.find((each) => each.id === id);
  const words = de.participant[document.settings.participantLabel];
  return found?.name ?? words.numbered({ n: found?.number ?? 0 });
}
