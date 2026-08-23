import { describe, expect, it } from 'vitest';

import type { GroupId, MatchId } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import { EMPTY_TOURNAMENT } from '@/domain/snapshot';
import { fixedClock, groupId, matchId, midTournament, round } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { blackout, showScene } from '@/store/actions/scene';
import {
  createTournamentStore,
  toSnapshot,
  type CommitMeta,
  type TournamentStore,
} from '@/store/tournamentStore';
import { EMPTY_HISTORY, UNDO_DEPTH, REDO_LOG_ACTION, UNDO_LOG_ACTION } from '@/store/undo';

describe('the host store handle', () => {
  it('offers no way to write state except through a commit', () => {
    const store = createTournamentStore();

    // The whole "one central broadcast" design rests on this. A reachable
    // setState lets a component change state that never bumps the revision,
    // and the broadcast skips it without a sound.
    expect(Object.keys(store).sort()).toEqual([
      'commit',
      'getState',
      'onCommit',
      'redo',
      'subscribe',
      'undo',
    ]);
    expect('setState' in store).toBe(false);
  });

  it('bumps the revision on every commit, including one that changes nothing', () => {
    const store = createTournamentStore();

    store.commit(() => ({}));
    store.commit(() => ({ autoFollow: false }));

    expect(store.getState().revision).toBe(2);
    expect(store.getState().autoFollow).toBe(false);
  });

  it('reports whether a commit touched the tournament', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.touchedTournament));

    store.commit(() => ({ autoFollow: false }));
    store.commit(() => ({ tournament: EMPTY_TOURNAMENT }));

    expect(seen).toEqual([false, true]);
  });

  it('reports a tournament touched in place, which a state comparison would miss', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.touchedTournament));

    // Actions are supposed to be immutable, but an in-place edit that still
    // returns the field must not be mistaken for "nothing changed" — that would
    // send it down the light channel and drop the data silently.
    store.commit((state) => {
      const tournament = state.tournament;
      return { tournament };
    });

    expect(seen).toEqual([true]);
  });

  /**
   * docs/FILE-FORMAT.md rule 4: round close and phase change are written at
   * once rather than after the debounce. Whether a commit is one of those is
   * something only the action knows, so it is passed rather than inferred —
   * and it has to reach the autosave through the same funnel everything else
   * uses (issue #10).
   */
  it('passes an urgent commit on as urgent, and an ordinary one as not', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.urgent));

    store.commit(() => ({ autoFollow: false }));
    store.commit(() => ({ autoFollow: true }), { urgent: true });
    store.commit(() => ({ autoFollow: false }), {});

    expect(seen).toEqual([false, true, false]);
  });

  it('stops notifying a listener that unsubscribed', () => {
    const store = createTournamentStore();
    let count = 0;
    const off = store.onCommit(() => (count += 1));

    store.commit(() => ({}));
    off();
    store.commit(() => ({}));

    expect(count).toBe(1);
  });
});

describe('toSnapshot', () => {
  it('describes the store as it is, defaulting to a live delivery', () => {
    const store = createTournamentStore();
    store.commit(() => ({ scene: { id: 'BRACKET' } }));

    expect(toSnapshot(store.getState())).toEqual({
      revision: 1,
      scene: { id: 'BRACKET' },
      autoFollow: true,
      tournament: EMPTY_TOURNAMENT,
      delivery: 'live',
    });
    expect(toSnapshot(store.getState(), 'catchUp').delivery).toBe('catchUp');
  });
});

/**
 * The undo stack, through the funnel every action goes through (issue #11).
 *
 * `undo.test.ts` proves what a snapshot holds. What is only reachable here is
 * what the host experiences: which commits are recorded, what an undo does to
 * the tournament, to the file and to the audit log, and where the history
 * stops.
 */
describe('undo and redo', () => {
  const PATH = 'C:\\Turniere\\Sommer.wattmatt';

  /** A store with a tournament open, the way `persistence` opens one. */
  function openStore(document: Tournament = midTournament()): TournamentStore {
    const store = createTournamentStore(undefined, { clock: fixedClock() });
    setOpenedDocument(store, document, PATH);
    return store;
  }

  function documentOf(store: TournamentStore): Tournament {
    const document = store.getState().document;
    if (document === null) {
      throw new Error('no tournament open');
    }
    return document;
  }

  /**
   * Setting a winner, written the way issue #17 will write it.
   *
   * The action itself belongs to the round control panel and does not exist
   * yet; #11 owns the mechanism under it. This commits exactly as that action
   * will — one labelled, logged, urgent commit through the store's funnel,
   * touching the match, its round and the table the match was occupying — so
   * what it proves about undo is what the host will get.
   */
  function setWinner(store: TournamentStore, id: MatchId, winner: GroupId, groupNumber: number) {
    store.commit(() => ({ document: withWinner(documentOf(store), id, winner) }), {
      undoLabel: `Winner set: group ${groupNumber}`,
      log: { action: 'MATCH_WINNER_SET', payload: { matchId: id, winnerId: winner } },
      urgent: true,
    });
  }

  function withWinner(document: Tournament, id: MatchId, winner: GroupId): Tournament {
    return {
      ...document,
      rounds: document.rounds.map((entry) => ({
        ...entry,
        state: entry.matches.some((m) => m.id === id) ? ('CLOSED' as const) : entry.state,
        matches: entry.matches.map((m) =>
          m.id === id ? { ...m, winnerId: winner, status: 'DONE' as const } : m,
        ),
      })),
      // The table the match was on is derived state, and exactly the kind an
      // undo written as an inverse operation forgets.
      tables: document.tables.map((entry) =>
        entry.currentMatchId === id
          ? { ...entry, status: 'FREE' as const, currentMatchId: null }
          : entry,
      ),
    };
  }

  /** Everything but the two fields a recorded decision always moves. */
  function comparable(document: Tournament) {
    const { log: _log, updatedAt: _updatedAt, ...rest } = document;
    return rest;
  }

  /** One draw, consuming from the tournament's own stream. */
  function drawOrder(store: TournamentStore): number[] {
    const document = documentOf(store);
    const rng = createRng(document.rngSeed, document.rngCursor);
    const order = rng.shuffle(document.groups.map((entry) => entry.number));

    store.commit(
      () => ({
        document: {
          ...document,
          rngCursor: rng.cursor,
          rounds: [...document.rounds, round(document.rounds.length + 1, { kind: 'BRACKET' })],
        },
      }),
      {
        undoLabel: 'Round drawn',
        log: { action: 'ROUND_DRAWN', payload: { order } },
        urgent: true,
      },
    );
    return order;
  }

  it('records a commit that says what the host did', () => {
    const store = openStore();
    setWinner(store, matchId(1), groupId(1), 1);

    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().history.past[0]?.label).toBe('Winner set: group 1');
  });

  it('leaves bookkeeping off the stack', () => {
    const store = openStore();
    // What `setDocumentSaved` does: a fact about the file, not a decision.
    store.commit(() => ({ file: { status: 'saved', path: PATH } }));

    expect(store.getState().history.past).toHaveLength(0);
    expect(store.undo()).toBe(false);
  });

  it('says so rather than pretending, when there is nothing to take back', () => {
    const store = openStore();

    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    // The failed undo committed nothing: only the open did.
    expect(store.getState().revision).toBe(1);
  });

  /**
   * Issue #11 acceptance criterion. "No trace" is asserted against the whole
   * tournament rather than against the match: an undo that put the winner back
   * but left the table free would pass any check narrow enough to be readable.
   */
  it('leaves no trace of the first result when the host corrects a winner', () => {
    const store = openStore();
    const before = documentOf(store);

    setWinner(store, matchId(1), groupId(1), 1);
    expect(store.undo()).toBe(true);
    setWinner(store, matchId(1), groupId(2), 2);

    expect(comparable(documentOf(store))).toEqual(
      comparable(withWinner(before, matchId(1), groupId(2))),
    );
  });

  it('puts the derived state back, not only the field the action set', () => {
    const store = openStore();
    const before = documentOf(store);

    setWinner(store, matchId(1), groupId(1), 1);
    expect(documentOf(store).tables[0]?.status).toBe('FREE');
    expect(documentOf(store).rounds[1]?.state).toBe('CLOSED');

    store.undo();

    expect(documentOf(store).tables[0]).toEqual(before.tables[0]);
    expect(documentOf(store).rounds[1]?.state).toBe('RUNNING');
    expect(documentOf(store).rounds[1]?.matches[0]?.status).toBe('RUNNING');
  });

  /**
   * Issue #11: an undo across a phase boundary "either works completely or is
   * blocked". A snapshot cannot restore half a tournament, so it works — the
   * phase is a field like any other, and so is everything the phase change
   * took with it.
   */
  it('crosses a phase boundary completely', () => {
    const store = openStore(midTournament({ phase: 'ELIMINATION' }));

    store.commit(
      () => ({ document: { ...documentOf(store), phase: 'BRACKET' as const, rounds: [] } }),
      { undoLabel: 'Phase advanced', log: { action: 'PHASE_ADVANCED', payload: {} }, urgent: true },
    );
    expect(documentOf(store).phase).toBe('BRACKET');

    store.undo();

    expect(documentOf(store).phase).toBe('ELIMINATION');
    expect(documentOf(store).rounds).toHaveLength(2);
  });

  /**
   * Issue #11 acceptance criterion, and CLAUDE.md golden rule 7. The cursor is
   * a stream position, not state: the room has already seen those numbers.
   * See docs/OPEN-QUESTIONS.md #32.
   */
  it('does not rewind the RNG cursor, so a redraw differs from the draw undone', () => {
    const store = openStore();

    const first = drawOrder(store);
    const cursorAfterFirst = documentOf(store).rngCursor;

    expect(store.undo()).toBe(true);
    expect(documentOf(store).rngCursor).toBe(cursorAfterFirst);
    // The round the draw added is gone; the stream position is not.
    expect(documentOf(store).rounds).toHaveLength(2);

    const second = drawOrder(store);

    expect(second).not.toEqual(first);
    expect(documentOf(store).rngCursor).toBeGreaterThan(cursorAfterFirst);
  });

  it('appends to the audit log instead of rewinding it', () => {
    const store = openStore();
    const before = documentOf(store).log.length;
    const opening = documentOf(store).log;

    setWinner(store, matchId(1), groupId(1), 1);
    store.undo();
    store.redo();

    const log = documentOf(store).log;
    expect(log.slice(before).map((entry) => entry.action)).toEqual([
      'MATCH_WINNER_SET',
      UNDO_LOG_ACTION,
      REDO_LOG_ACTION,
    ]);
    // Every entry that was there before is still there, in order.
    expect(log.slice(0, before)).toEqual(opening);
    expect(log[before]?.payload).toEqual({ matchId: matchId(1), winnerId: groupId(1) });
    expect(log[before + 1]?.payload).toEqual({
      action: 'MATCH_WINNER_SET',
      label: 'Winner set: group 1',
    });
    expect(log[before]?.at).toBe(fixedClock().now());
  });

  it('stamps the tournament as changed only for a recorded decision', () => {
    const store = openStore(midTournament({ updatedAt: '2020-01-01T00:00:00+02:00' }));

    store.commit(() => ({ file: { status: 'saved', path: PATH } }));
    expect(documentOf(store).updatedAt).toBe('2020-01-01T00:00:00+02:00');

    setWinner(store, matchId(1), groupId(1), 1);
    expect(documentOf(store).updatedAt).toBe(fixedClock().now());
  });

  it('writes an undo back to disk at once, like the decision it corrects', () => {
    const store = openStore();
    const seen: CommitMeta[] = [];
    store.onCommit((_state, meta) => seen.push(meta));

    setWinner(store, matchId(1), groupId(1), 1);
    const revisionBefore = store.getState().documentRevision;
    store.undo();

    // A crash a second after a correction must not hand back the version the
    // host has just disowned, so the undo is urgent and leaves the file behind.
    expect(seen.at(-1)?.urgent).toBe(true);
    expect(seen.at(-1)?.touchedTournament).toBe(true);
    expect(store.getState().documentRevision).toBe(revisionBefore + 1);
    expect(store.getState().file).toEqual({ status: 'modified', path: PATH });
  });

  it('tells the beamer to settle rather than animate into an undo', () => {
    const store = openStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.settled));

    setWinner(store, matchId(1), groupId(1), 1);
    store.undo();
    store.redo();

    expect(seen).toEqual([false, true, true]);
  });

  it('carries the beamer picture back with the tournament', () => {
    const store = openStore();
    showScene(store, { id: 'BRACKET' });
    blackout(store);

    expect(store.getState().scene).toEqual({ id: 'BLACKOUT' });

    store.undo();
    expect(store.getState().scene).toEqual({ id: 'BRACKET' });
    store.undo();
    expect(store.getState().scene).toEqual({ id: 'IDLE' });
    expect(store.getState().autoFollow).toBe(true);
  });

  /**
   * docs/FILE-FORMAT.md rule 6, from the other end. A beamer scene deliberately
   * never touches the tournament, so taking one back must not either: an undo
   * that rewrote the document would dirty a clean file, force an urgent write
   * with its backup rotation, append an audit entry for a scene change and push
   * the correction onto the heavy sync channel — putting the one action that
   * must never queue behind sixty-four groups of data behind exactly that.
   */
  it('leaves the tournament, the file and the log alone when it takes back a blackout', () => {
    const store = openStore();
    const seen: CommitMeta[] = [];
    store.onCommit((_state, meta) => seen.push(meta));

    blackout(store);
    const document = documentOf(store);
    const documentRevision = store.getState().documentRevision;

    expect(store.undo()).toBe(true);

    expect(store.getState().scene).toEqual({ id: 'IDLE' });
    expect(store.getState().autoFollow).toBe(true);
    // The same object, not merely an equal one: nothing was rewritten.
    expect(documentOf(store)).toBe(document);
    expect(documentOf(store).log.some((entry) => entry.action === UNDO_LOG_ACTION)).toBe(false);
    expect(store.getState().documentRevision).toBe(documentRevision);
    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(seen.at(-1)).toEqual({ touchedTournament: false, urgent: false, settled: true });
  });

  it('puts the blackout back the same cheap way', () => {
    const store = openStore();
    blackout(store);
    store.undo();

    const document = documentOf(store);
    const seen: CommitMeta[] = [];
    store.onCommit((_state, meta) => seen.push(meta));

    expect(store.redo()).toBe(true);

    expect(store.getState().scene).toEqual({ id: 'BLACKOUT' });
    expect(documentOf(store)).toBe(document);
    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(seen.at(-1)).toEqual({ touchedTournament: false, urgent: false, settled: true });
  });

  /**
   * What a step cost is a property of the step, not of the stack it is on: a
   * host who blacks the projector out, enters a result and takes both back
   * gets one tournament write and one scene change, in that order.
   */
  it('decides per step what taking it back costs', () => {
    const store = openStore();
    const seen: CommitMeta[] = [];
    store.onCommit((_state, meta) => seen.push(meta));

    blackout(store);
    setWinner(store, matchId(1), groupId(1), 1);

    store.undo();
    store.undo();

    expect(seen.map((meta) => meta.touchedTournament)).toEqual([false, true, true, false]);
    expect(seen.map((meta) => meta.urgent)).toEqual([false, true, true, false]);
    expect(store.getState().scene).toEqual({ id: 'IDLE' });
    expect(documentOf(store).rounds[1]?.state).toBe('RUNNING');
  });

  /**
   * The start screen. There is nothing to go back to and no button to show a
   * step on — the undo controls live with the tournament — so a labelled
   * commit applies and the stack stays empty, rather than offering the host an
   * undo that could not restore anything. Unreachable today: every action that
   * labels itself needs a tournament. Asserted because the day one does not,
   * the alternative is a button that throws mid-event.
   */
  it('drops a labelled commit made before a tournament is open', () => {
    const store = createTournamentStore(undefined, { clock: fixedClock() });

    store.commit(() => ({ autoFollow: false }), { undoLabel: 'Auto-follow off' });

    expect(store.getState().autoFollow).toBe(false);
    expect(store.getState().history).toEqual(EMPTY_HISTORY);
    expect(store.undo()).toBe(false);
  });

  it('drops the redo as soon as the host commits something new', () => {
    const store = openStore();

    setWinner(store, matchId(1), groupId(1), 1);
    store.undo();
    expect(store.getState().history.future).toHaveLength(1);

    setWinner(store, matchId(1), groupId(2), 2);

    expect(store.getState().history.future).toHaveLength(0);
    expect(store.redo()).toBe(false);
  });

  it('keeps the last fifty steps and no more', () => {
    const store = openStore();
    for (let step = 0; step < UNDO_DEPTH + 5; step += 1) {
      showScene(store, { id: step % 2 === 0 ? 'BRACKET' : 'CEREMONY' });
    }

    expect(store.getState().history.past).toHaveLength(UNDO_DEPTH);
  });

  /**
   * docs/OPEN-QUESTIONS.md #20: the history does not reach across a document
   * switch. Undoing into a step from the previous tournament would restore the
   * previous event over the current one.
   */
  it('starts over when a different tournament is opened', () => {
    const store = openStore();
    setWinner(store, matchId(1), groupId(1), 1);

    setOpenedDocument(store, midTournament({ name: 'Winterturnier' }), PATH);

    expect(store.getState().history.past).toHaveLength(0);
    expect(store.undo()).toBe(false);
  });

  it('starts over when the tournament is closed', () => {
    const store = openStore();
    setWinner(store, matchId(1), groupId(1), 1);

    closeDocument(store);

    expect(store.getState().history.past).toHaveLength(0);
    expect(store.undo()).toBe(false);
  });

  it('never sends the stack to the beamer', () => {
    const store = openStore();
    setWinner(store, matchId(1), groupId(1), 1);

    expect(Object.keys(toSnapshot(store.getState())).sort()).toEqual([
      'autoFollow',
      'delivery',
      'revision',
      'scene',
      'tournament',
    ]);
  });
});
