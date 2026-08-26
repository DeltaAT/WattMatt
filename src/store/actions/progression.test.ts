import { describe, expect, it } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, roundId, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { advancePhase } from '@/store/actions/progression';
import { showScene } from '@/store/actions/scene';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The phase action (issue #22).
 *
 * The rules are `@/domain/progression`'s and are tested there. What is checked here is
 * what an action adds: the German step the undo button reads, the audit entry
 * the file keeps, the beamer picture that travels with the step into the
 * `Hoffnungsrunde`, and the two things it refuses to do — commit with no
 * tournament open, and commit a step the domain declined to take.
 */

/** A tournament whose qualifying round is drawn, decided and closed. */
function qualified(groups: number, tables = 4): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => `Runde ${index}` });
  const round = currentRound(drawn);
  if (round === null) {
    throw new Error('nothing was drawn');
  }

  return closeRound(
    round.matches.reduce(
      (next, match) => (match.b === null ? next : setWinner(next, match.id, match.a)),
      drawn,
    ),
  );
}

function ready(document: Tournament): TournamentStore {
  const store = createTournamentStore();
  store.commit(() => ({ document }));
  return store;
}

function open(store: TournamentStore): Tournament {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament is open');
  }
  return document;
}

describe('advancePhase', () => {
  it('moves the tournament into the next phase in one commit', () => {
    // 64 leaves 32 standing, a power of two, so §4 is skipped outright.
    const store = ready(qualified(64));
    const before = store.getState().revision;

    advancePhase(store);

    expect(open(store).phase).toBe('ELIMINATION');
    expect(store.getState().revision).toBe(before + 1);
  });

  it('names the phase it moved into on the undo step', () => {
    const store = ready(qualified(64));

    advancePhase(store);

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.phaseAdvanced({ phase: de.phase.name.ELIMINATION }),
    );
  });

  /*
   * The field is in the log because it is what answers "why is the Turnierbaum
   * this size?" half an hour later, without anybody having to replay the
   * evening (docs/FILE-FORMAT.md rule 6).
   */
  it('records where the tournament went and how many it carried', () => {
    const store = ready(qualified(64));

    advancePhase(store);

    expect(open(store).log.at(-1)).toMatchObject({
      action: 'PHASE_ADVANCED',
      payload: { from: 'QUALIFYING', to: 'ELIMINATION', field: 32 },
    });
  });

  /*
   * Entering the `Hoffnungsrunde` *is* the shuffle (docs/OPEN-QUESTIONS.md #54),
   * so the pot and the picture of it have to land in the same commit as the
   * phase — an undo that took one back and left the other would put the
   * projector on a phase that no longer exists (golden rule 4).
   */
  it('stages the pot in the same commit as the step into the Hoffnungsrunde', () => {
    const store = ready(qualified(40));

    advancePhase(store);

    expect(open(store).phase).toBe('REPECHAGE');
    expect(open(store).repechage?.pool).toHaveLength(20);
    expect(store.getState().scene).toEqual({ id: 'REPECHAGE' });
    expect(open(store).log.at(-1)?.payload).toMatchObject({ to: 'REPECHAGE' });
  });

  /*
   * The opposite reason to the `Hoffnungsrunde`'s: nothing is about to happen
   * out there for several minutes, and whatever was on the wall would either go
   * stale or — for the field of participants — fill up one name at a time while
   * the host types (issue #23, docs/TOURNAMENT-RULES.md §6).
   */
  it('stages the holding picture with the step into the naming phase', () => {
    // 16 leaves 8 standing, a power of two, so the final phase is next.
    const store = ready(qualified(16));

    advancePhase(store);

    expect(open(store).phase).toBe('NAMING');
    expect(store.getState().scene).toEqual({ id: 'NAMING' });
  });

  it('takes the holding picture back off with an undo of the step', () => {
    const store = ready(qualified(16));

    advancePhase(store);
    expect(store.undo()).toBe(true);

    expect(open(store).phase).toBe('QUALIFYING');
    expect(store.getState().scene).toEqual(INITIAL_TOURNAMENT_STATE.scene);
  });

  /*
   * Every other step follows the phase rather than staging a fixed picture,
   * which is the whole of `autoFollow` (issue #28). 64 groups leave 32
   * standing, so this is the step into the elimination rounds, and the honest
   * picture there is the board of the round the room has just watched.
   */
  it('follows the phase onto the board of the round that just finished', () => {
    const store = ready(qualified(64));

    advancePhase(store);

    expect(open(store).phase).toBe('ELIMINATION');
    expect(store.getState().scene).toEqual({ id: 'ROUND_BOARD', roundId: roundId(1) });
  });

  it('leaves the projector alone once the host has taken it by hand', () => {
    const store = ready(qualified(64));
    showScene(store, { id: 'TABLE_OVERVIEW' });

    advancePhase(store);

    // Auto-follow is off from the moment the host stages anything, and stays
    // off until they hand the beamer back (golden rule 3). It must never take
    // the screen away from an explanation that is still going on.
    expect(store.getState().autoFollow).toBe(false);
    expect(store.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });
  });

  it('puts the phase back, and the pot with it, when the host undoes it', () => {
    const store = ready(qualified(40));

    advancePhase(store);
    expect(store.undo()).toBe(true);

    expect(open(store).phase).toBe('QUALIFYING');
    expect(open(store).repechage).toBeNull();
    expect(store.getState().scene).toEqual(INITIAL_TOURNAMENT_STATE.scene);
  });

  /*
   * The guard that makes a stale click during a live event cost nothing: the
   * round is still open, the domain hands its argument back, and nothing lands
   * on the undo stack to take back.
   */
  it('commits nothing while a blocker is standing', () => {
    // The round is drawn but not closed, which is `ROUND_OPEN`.
    const open40 = drawRound(
      tournament({
        phase: 'QUALIFYING',
        groups: Array.from({ length: 40 }, (_unused, index) => group(index + 1)),
        nextGroupNumber: 41,
        tables: [table(1)],
        nextTableNumber: 2,
      }),
      { at: FIXED_NOW, label: (index) => `Runde ${index}` },
    );
    const store = ready(open40);
    const before = store.getState();

    advancePhase(store);

    expect(store.getState()).toBe(before);
  });

  it('commits nothing with no tournament open', () => {
    const store = createTournamentStore();
    const before = store.getState();

    advancePhase(store);

    expect(store.getState()).toBe(before);
  });
});
