import { describe, expect, it } from 'vitest';

import { consolationField } from '@/domain/consolation';
import { closeRound as closeRoundIn, drawRound as drawRoundIn, setWinner } from '@/domain/draw';
import { fromTournamentFile, toTournamentFile } from '@/domain/factory';
import { isRepechageComplete, repechageState } from '@/domain/repechage';
import { tournamentFileSchema } from '@/domain/schema';
import { consolationGroups, currentRound, roundsOfTrack } from '@/domain/selectors';
import { FIXED_NOW, fixedClock, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { drawBracket, finishBracket, setBracketWinner } from '@/store/actions/bracket';
import { declineConsolation, startConsolation } from '@/store/actions/consolation';
import { setOpenedDocument } from '@/store/actions/document';
import { advancePhase } from '@/store/actions/progression';
import {
  acceptRepechageCandidate,
  declineRepechageCandidate,
  drawRepechageCandidate,
} from '@/store/actions/repechage';
import { closeRound, drawRound, setMatchWinner, startNextMatch } from '@/store/actions/round';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The `Trostrunde` through the store (issue #73,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * The rules are `@/domain/consolation`'s and are tested there. What is checked
 * here is what the store adds: the German the undo button reads, the audit
 * entry the file keeps, that the round actions really do run the side event's
 * track — and the property the issue names last and cares about most, that an
 * undo in one track leaves the other one exactly as it was.
 */

const CLOCK = fixedClock();

/** `groups` participants played through the qualifying round: half through, half out. */
function afterQualifying(groups = 16, tables = 4): Tournament {
  const ready = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRoundIn(ready, { at: FIXED_NOW, label: (index) => `Round ${index}` });
  let next = drawn;
  for (const match of currentRound(next)?.matches ?? []) {
    if (match.b !== null) {
      next = setWinner(next, match.id, match.a);
    }
  }
  return closeRoundIn(next);
}

/** The same qualifying round, drawn and **not** decided — nothing is fixed yet. */
function afterQualifyingOpen(groups = 16, tables = 4): Tournament {
  const ready = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });
  return drawRoundIn(ready, { at: FIXED_NOW, label: (index) => `Round ${index}` });
}

/**
 * The store with the tournament **opened** rather than injected.
 *
 * Through `setOpenedDocument` and therefore through `commit`, which is where
 * the `Trostrunde`'s field is settled (issue #102). A document dropped straight
 * into the initial state would never have been committed, so its field would
 * still be null and every test below would be running against a side event that
 * cannot be started — which is a path no host ever walks.
 */
function setup(document: Tournament = afterQualifying()): TournamentStore {
  const store = createTournamentStore({ ...INITIAL_TOURNAMENT_STATE }, { clock: CLOCK });
  setOpenedDocument(store, document, 'C:\\T.wattmatt');
  return store;
}

/** Marks a winner in every side-event bracket node that has two participants. */
function playOutBracket(store: TournamentStore): void {
  for (let pass = 0; pass < 6; pass += 1) {
    const nodes = documentOf(store).consolation?.bracket?.nodes ?? [];
    const open = nodes.filter(
      (node) => node.slotA !== null && node.slotB !== null && node.winnerId === null,
    );
    if (open.length === 0) {
      return;
    }
    for (const node of open) {
      setBracketWinner(store, node.id, node.slotA!, 'CONSOLATION');
    }
  }
}

const documentOf = (store: TournamentStore): Tournament => {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

const lastLog = (store: TournamentStore) => documentOf(store).log.at(-1);

const trackOf = (document: Tournament, track: 'MAIN' | 'CONSOLATION'): readonly Round[] =>
  roundsOfTrack(document, track);

describe('startConsolation', () => {
  it('moves the field across and records the decision in one commit', () => {
    const store = setup();
    const field = consolationField(documentOf(store));

    startConsolation(store);

    expect(consolationGroups(documentOf(store))).toHaveLength(field.length);
    expect(documentOf(store).consolation).toEqual({
      state: 'RUNNING',
      phase: 'QUALIFYING',
      repechage: null,
      bracket: null,
      winnerId: null,
    });
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.consolationStarted({ n: field.length }),
    );
  });

  it('writes who was in it when the host said yes', () => {
    const store = setup();
    const field = consolationField(documentOf(store));

    startConsolation(store);

    expect(lastLog(store)).toMatchObject({
      action: 'CONSOLATION_STARTED',
      payload: { field: field.map((entry) => entry.id), size: field.length },
    });
  });

  it('commits nothing when a blocker is standing', () => {
    // Started once, so the second press is answering a question that has been
    // answered — the guard that makes a stale click during a live event free.
    const store = setup();
    startConsolation(store);
    const revision = store.getState().revision;

    startConsolation(store);

    expect(store.getState().revision).toBe(revision);
  });

  it('commits nothing with no tournament open', () => {
    const store = createTournamentStore(INITIAL_TOURNAMENT_STATE, { clock: CLOCK });

    startConsolation(store);

    expect(store.getState().revision).toBe(INITIAL_TOURNAMENT_STATE.revision);
  });
});

describe('declineConsolation', () => {
  it('records the answer so the panel stops asking', () => {
    const store = setup();

    declineConsolation(store);

    expect(documentOf(store).consolation).toEqual({
      state: 'DECLINED',
      phase: 'SETUP',
      repechage: null,
      bracket: null,
      winnerId: null,
    });
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.consolationDeclined);
    expect(lastLog(store)).toMatchObject({ action: 'CONSOLATION_DECLINED' });
  });

  it('is undoable, so a host who changes their mind is not stuck', () => {
    const store = setup();
    declineConsolation(store);

    store.undo();

    expect(documentOf(store).consolation).toBeNull();
  });
});

describe('the round actions on the CONSOLATION track', () => {
  function running(): TournamentStore {
    const store = setup();
    startConsolation(store);
    return store;
  }

  it('draws a Trostrunde round and stages it on the beamer', () => {
    const store = running();

    drawRound(store, 'CONSOLATION');

    const drawn = currentRound(documentOf(store), 'CONSOLATION');
    // The kind is the stage; the track is which tournament (issue #91).
    expect(drawn?.kind).toBe('QUALIFYING');
    expect(drawn?.track).toBe('CONSOLATION');
    expect(drawn?.label).toBe(de.consolation.title({ n: 1 }));
    expect(store.getState().scene).toEqual({ id: 'DRAW', roundId: drawn?.id });
  });

  it('leaves the main field with nothing open', () => {
    const store = running();

    drawRound(store, 'CONSOLATION');

    expect(currentRound(documentOf(store), 'MAIN')).toBeNull();
  });

  it('records which track a match was started on', () => {
    const store = running();
    drawRound(store, 'CONSOLATION');
    const free = documentOf(store).tables.find((seat) => seat.status === 'FREE');
    if (free === undefined) {
      return;
    }

    startNextMatch(store, free.id, 'CONSOLATION');

    expect(lastLog(store)).toMatchObject({
      action: 'MATCH_ASSIGNED',
      payload: { track: 'CONSOLATION' },
    });
  });

  it('records the winner and the loser of a closed Trostrunde round', () => {
    const store = running();
    drawRound(store, 'CONSOLATION');
    playOutOpen(store, 'CONSOLATION');

    closeRound(store, 'CONSOLATION');

    expect(lastLog(store)).toMatchObject({
      action: 'ROUND_CLOSED',
      payload: { track: 'CONSOLATION' },
    });
  });

  /*
   * Issue #91: the side event runs the whole pipeline, so its winner is the
   * winner of *its bracket* and not of its last round. Eight in the pot means
   * one round of four, then a tree of four — every step of it the same store
   * action the main field uses, with the track set the other way.
   */
  it('runs the side event to a winner through its own bracket', () => {
    const store = running();

    drawRound(store, 'CONSOLATION');
    playOutOpen(store, 'CONSOLATION');
    closeRound(store, 'CONSOLATION');
    advancePhase(store, 'CONSOLATION');

    expect(documentOf(store).consolation?.phase).toBe('BRACKET');
    drawBracket(store, CLOCK, 'CONSOLATION');
    playOutBracket(store);
    finishBracket(store, 'CONSOLATION');

    const document = documentOf(store);
    expect(document.consolation?.state).toBe('FINISHED');
    expect(document.consolation?.winnerId).toBe(consolationGroups(document)[0]?.id);
    expect(trackOf(document, 'CONSOLATION')).toHaveLength(1);
  });

  /*
   * The close and the winner are one commit, not two. An undo that took the
   * close back but left the side event decided would offer the host a draw with
   * one group in the pot (CLAUDE.md golden rule 6).
   */
  it('takes the winner back with the press it came from', () => {
    const store = running();
    drawRound(store, 'CONSOLATION');
    playOutOpen(store, 'CONSOLATION');
    closeRound(store, 'CONSOLATION');
    advancePhase(store, 'CONSOLATION');
    drawBracket(store, CLOCK, 'CONSOLATION');
    playOutBracket(store);
    finishBracket(store, 'CONSOLATION');

    store.undo();

    expect(documentOf(store).consolation?.state).toBe('RUNNING');
    expect(documentOf(store).consolation?.winnerId).toBeNull();
  });
});

describe('the field, fixed once (issue #102)', () => {
  /**
   * The whole of issue #102 through the store: the `Trostrunde`'s field is
   * written into the document by `commit` at the moment §10 fixes it, and
   * nothing the main field does afterwards touches it.
   *
   * 16 groups leave 8 winners, which is already a power of two, so §4 is
   * skipped and the moment is the close of the qualifying round itself
   * (docs/TOURNAMENT-RULES.md §9 case 2).
   */
  it('is written by the commit that closes the qualifying round', () => {
    const store = createTournamentStore({ ...INITIAL_TOURNAMENT_STATE }, { clock: CLOCK });
    const open = afterQualifyingOpen();
    setOpenedDocument(store, open, 'C:\\T.wattmatt');

    // Nothing is fixed while the round is open.
    expect(documentOf(store).consolationField).toBeNull();

    for (const match of currentRound(documentOf(store))?.matches ?? []) {
      if (match.b !== null) {
        setMatchWinner(store, match.id, match.a);
      }
    }
    expect(documentOf(store).consolationField).toBeNull();

    closeRound(store, 'MAIN');

    expect(documentOf(store).consolationField).toHaveLength(8);
    expect(consolationField(documentOf(store))).toHaveLength(8);
  });

  /*
   * The bug the issue reports, at the level the host meets it: the main field
   * plays a further round before the side event is started, and its losers do
   * not join a round that exists for the losers of round 1.
   */
  it('does not change when the main field plays another round', () => {
    const store = setup(afterQualifying(64));
    const field = documentOf(store).consolationField;
    expect(field).toHaveLength(32);

    const advanced: Tournament = { ...documentOf(store), phase: 'ELIMINATION' };
    store.commit(() => ({ document: advanced }), { undoLabel: de.phase.eliminationRound });
    drawRound(store, 'MAIN');
    playOutOpen(store, 'MAIN');
    closeRound(store, 'MAIN');

    // Sixteen more groups are out, and the field is the list it always was.
    expect(documentOf(store).consolationField).toEqual(field);
    expect(consolationGroups(documentOf(store))).toHaveLength(0);

    startConsolation(store);
    expect(consolationGroups(documentOf(store))).toHaveLength(32);
    for (const entry of consolationGroups(documentOf(store))) {
      expect(field).toContain(entry.id);
    }
  });

  /*
   * The one thing that is allowed to change it (issue #102's fourth task).
   *
   * A decline is the answer that *keeps* a group in the side event, so taking
   * one back has to take the group back out of the field — and it does, because
   * the undo stack restores the whole document from before the answer and the
   * next answer fixes it again.
   */
  it('follows an undo of a Hoffnungsrunde decline back and forward', () => {
    // 12 groups: 6 winners, so §4 owes two places and the lottery really runs.
    const store = setup(afterQualifying(12));
    expect(documentOf(store).consolationField).toBeNull();

    advancePhase(store);
    expect(documentOf(store).phase).toBe('REPECHAGE');

    drawRepechageCandidate(store);
    const candidate = repechageState(documentOf(store))?.pending;
    expect(candidate).toBeDefined();

    declineRepechageCandidate(store);
    drawRepechageCandidate(store);
    acceptRepechageCandidate(store);
    drawRepechageCandidate(store);
    acceptRepechageCandidate(store);

    // The lottery has filled its two places, so the field is fixed — and the
    // group that said no is in it.
    expect(isRepechageComplete(documentOf(store))).toBe(true);
    expect(documentOf(store).consolationField).toContain(candidate);

    // Back through every answer: the field is not fixed any more, because the
    // lottery is not closed any more.
    for (let step = 0; step < 5; step += 1) {
      store.undo();
    }
    expect(isRepechageComplete(documentOf(store))).toBe(false);
    expect(documentOf(store).consolationField).toBeNull();

    // The host answers *Ja* this time, and the field that is fixed on the way
    // out is a field without them in it.
    acceptRepechageCandidate(store);
    drawRepechageCandidate(store);
    acceptRepechageCandidate(store);

    expect(isRepechageComplete(documentOf(store))).toBe(true);
    expect(documentOf(store).consolationField).not.toContain(candidate);
  });

  /* CLAUDE.md §7: the file the host reopens is the tournament they left. */
  it('survives a write and a read unchanged', () => {
    const store = setup(afterQualifying(64));
    const field = documentOf(store).consolationField;
    expect(field).toHaveLength(32);

    const file = toTournamentFile(documentOf(store), '0.1.0');
    const reread = fromTournamentFile(
      tournamentFileSchema.parse(JSON.parse(JSON.stringify(file)) as unknown),
    );

    expect(reread.consolationField).toEqual(field);
    expect(consolationField(reread)).toEqual(consolationField(documentOf(store)));
  });
});

describe('undo across the two tracks', () => {
  /**
   * Both tracks live: the main field in an elimination round, the side event in
   * its first. 16 groups is the smallest field that reaches this — 8 through,
   * 8 out — with the phase moved on by hand, because §5's transition is issue
   * #22's and not what is under test here.
   */
  function bothLive(): TournamentStore {
    // 64 groups: 32 through, 32 out. Already a power of two, so §4 is skipped
    // (§9 case 2), and 32 is still above the final phase, so §5 has an
    // elimination round left to deal — the only state in which both tracks are
    // genuinely live at the same time.
    const store = setup(afterQualifying(64));
    startConsolation(store);
    // The phase moves on by hand: §5's transition is issue #22's and not what
    // is under test here.
    const advanced: Tournament = { ...documentOf(store), phase: 'ELIMINATION' };
    store.commit(() => ({ document: advanced }), { undoLabel: de.phase.eliminationRound });
    drawRound(store, 'MAIN');
    drawRound(store, 'CONSOLATION');
    return store;
  }

  it('leaves the Trostrunde byte-identical when a main-field result is undone', () => {
    const store = bothLive();
    const before = trackOf(documentOf(store), 'CONSOLATION');
    const consolationBefore = documentOf(store).consolation;

    const target = currentRound(documentOf(store), 'MAIN')?.matches.find(
      (match) => match.b !== null,
    );
    expect(target).toBeDefined();

    setMatchWinner(store, target!.id, target!.a);
    // Untouched while the result stands…
    expect(trackOf(documentOf(store), 'CONSOLATION')).toEqual(before);

    store.undo();

    // …and untouched after the undo, which is the property the issue asks for.
    expect(trackOf(documentOf(store), 'CONSOLATION')).toEqual(before);
    expect(documentOf(store).consolation).toEqual(consolationBefore);
  });

  it('leaves the main field byte-identical when a Trostrunde result is undone', () => {
    const store = bothLive();
    const mainBefore = trackOf(documentOf(store), 'MAIN');
    const target = currentRound(documentOf(store), 'CONSOLATION')?.matches.find(
      (match) => match.b !== null,
    );
    expect(target).toBeDefined();

    setMatchWinner(store, target!.id, target!.a);

    // Still untouched while the result stands…
    expect(trackOf(documentOf(store), 'MAIN')).toEqual(mainBefore);

    store.undo();

    // …and still untouched after the undo, which is the property the issue
    // asks for: the two halves of the evening do not reach into each other.
    expect(trackOf(documentOf(store), 'MAIN')).toEqual(mainBefore);
  });

  it('keeps every group of one track out of the other one’s rounds', () => {
    const store = bothLive();
    const document = documentOf(store);
    const sideEvent = new Set(consolationGroups(document).map((entry) => entry.id));

    for (const match of currentRound(document, 'MAIN')?.matches ?? []) {
      expect(sideEvent.has(match.a)).toBe(false);
      if (match.b !== null) {
        expect(sideEvent.has(match.b)).toBe(false);
      }
    }
  });
});

/** Marks every open match of the track's round, `a` winning. */
function playOutOpen(store: TournamentStore, track: 'MAIN' | 'CONSOLATION'): void {
  const round = currentRound(documentOf(store), track);
  for (const match of round?.matches ?? []) {
    if (match.b !== null && match.winnerId === null) {
      setMatchWinner(store, match.id, match.a);
    }
  }
}
