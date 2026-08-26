import { describe, expect, it } from 'vitest';

import type { BracketNodeId, GroupId } from '@/domain/ids';
import { group, table, tableId, tournament } from '@/domain/testFixtures';
import type { Bracket, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import {
  drawBracket,
  finishBracket,
  setBracketWinner,
  showBracketOnBeamer,
  startNextBracketMatch,
} from '@/store/actions/bracket';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The bracket actions (issue #24).
 *
 * The rules are `@/domain/bracket`'s and are tested there. What is checked here
 * is what an action adds: the German the undo button reads, the audit entry the
 * file keeps, the beamer picture that travels with the draw — and the one
 * property the issue states as a test of its own, that undoing a bracket result
 * also takes back the third-place placement it caused.
 */

function readyToDraw(count: number, tables = 2): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: Array.from({ length: count }, (_unused, index) =>
      group(index + 1, { name: `Team ${index + 1}` }),
    ),
    nextGroupNumber: count + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });
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

function bracketOf(store: TournamentStore): Bracket {
  const bracket = open(store).bracket;
  if (bracket === null) {
    throw new Error('no bracket has been drawn');
  }
  return bracket;
}

function slotsOf(store: TournamentStore, id: string): [GroupId | null, GroupId | null] {
  const node = bracketOf(store).nodes.find((candidate) => candidate.id === id);
  return [node?.slotA ?? null, node?.slotB ?? null];
}

/** The name the host typed, which is what the undo button reads back (§6). */
function nameOf(store: TournamentStore, groupId: GroupId | null): string {
  return open(store).groups.find((group) => group.id === groupId)?.name ?? '';
}

describe('drawBracket', () => {
  it('draws the tree and enters the final phase in one commit', () => {
    const store = ready(readyToDraw(4));
    const before = store.getState().revision;

    drawBracket(store);

    expect(store.getState().revision).toBe(before + 1);
    expect(open(store).phase).toBe('BRACKET');
    expect(bracketOf(store).size).toBe(4);
  });

  it('puts the bracket on the beamer in the same commit', () => {
    const store = ready(readyToDraw(4));

    drawBracket(store);

    expect(store.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('names the step on the undo stack in German', () => {
    const store = ready(readyToDraw(4));

    drawBracket(store);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.bracketDrawn);
  });

  it('logs the whole tree and the cursor it was dealt from', () => {
    const store = ready(readyToDraw(4));

    drawBracket(store);

    const entry = open(store).log.at(-1);
    expect(entry?.action).toBe('BRACKET_DRAWN');
    expect(entry?.payload.size).toBe(4);
    expect(entry?.payload.nodes).toHaveLength(4);
    expect(entry?.payload.rngCursor).toBe(open(store).rngCursor);
  });

  it('commits nothing when the domain refuses the draw', () => {
    // A name is missing, so §6 holds the bracket back.
    const store = ready({
      ...readyToDraw(4),
      groups: [group(1, { name: 'Team 1' }), group(2, { name: 'Team 2' }), group(3), group(4)],
    });
    const before = store.getState().revision;

    drawBracket(store);

    expect(store.getState().revision).toBe(before);
    expect(open(store).bracket).toBeNull();
  });

  it('does nothing with no tournament open', () => {
    const store = createTournamentStore();

    drawBracket(store);

    expect(store.getState().document).toBeNull();
    expect(store.getState().revision).toBe(0);
  });
});

describe('setBracketWinner', () => {
  it('names the participant on the undo button, and says when it was a correction', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const [winner, loser] = slotsOf(store, 'bn_1');

    setBracketWinner(store, 'bn_1' as BracketNodeId, winner as GroupId);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchWinnerSet({ participant: nameOf(store, winner) }),
    );

    setBracketWinner(store, 'bn_1' as BracketNodeId, loser as GroupId);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchWinnerCorrected({ participant: nameOf(store, loser) }),
    );
  });

  it('logs the result it replaced and where the loser went', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const [winner, loser] = slotsOf(store, 'bn_1');

    setBracketWinner(store, 'bn_1' as BracketNodeId, winner as GroupId);

    const entry = open(store).log.at(-1);
    expect(entry?.action).toBe('BRACKET_WINNER_SET');
    expect(entry?.payload).toMatchObject({
      nodeId: 'bn_1',
      round: 'SEMI_FINAL',
      winnerId: winner,
      previousWinnerId: null,
      loserId: loser,
      thirdPlaceNodeId: 'bn_3',
    });
  });

  /*
   * The test issue #24 asks for by name. A semi-final decides two things at
   * once, and one press of Rückgängig has to take back both — otherwise the
   * `Spiel um Platz 3` on the projector names somebody who has not lost.
   */
  it('undoes the third-place placement together with the result that caused it', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const [winner, loser] = slotsOf(store, 'bn_1');

    setBracketWinner(store, 'bn_1' as BracketNodeId, winner as GroupId);
    expect(slotsOf(store, 'bn_3')[0]).toBe(loser);
    expect(slotsOf(store, 'bn_4')[0]).toBe(winner);

    expect(store.undo()).toBe(true);

    expect(slotsOf(store, 'bn_3')[0]).toBeNull();
    expect(slotsOf(store, 'bn_4')[0]).toBeNull();
    expect(bracketOf(store).nodes[0]?.winnerId).toBeNull();
    // And the table the match was on is occupied again, because undo restores
    // the whole document rather than the bracket alone.
    expect(open(store).tables[0]?.currentMatchId).toBe('bn_1');
  });

  it('commits nothing when the domain refuses the result', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const before = store.getState().revision;

    // Not in this match.
    setBracketWinner(store, 'bn_1' as BracketNodeId, slotsOf(store, 'bn_2')[0] as GroupId);

    expect(store.getState().revision).toBe(before);
  });
});

describe('a correction that discards results (issue #26)', () => {
  /** A bracket of four played to the end: both semi-finals, final, third place. */
  function played(): TournamentStore {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const semis = bracketOf(store).nodes.filter((node) => node.round === 'SEMI_FINAL');
    for (const semi of semis) {
      setBracketWinner(store, semi.id, semi.slotA as GroupId);
    }
    setBracketWinner(store, 'bn_4' as BracketNodeId, slotsOf(store, 'bn_4')[0] as GroupId);
    setBracketWinner(store, 'bn_3' as BracketNodeId, slotsOf(store, 'bn_3')[0] as GroupId);
    return store;
  }

  it('says on the undo button how much is being thrown away', () => {
    const store = played();
    const [, loser] = slotsOf(store, 'bn_1');

    setBracketWinner(store, 'bn_1' as BracketNodeId, loser as GroupId);

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.bracketCorrected({ participant: nameOf(store, loser), n: 2 }),
    );
  });

  it('logs which results were discarded', () => {
    const store = played();
    const [, loser] = slotsOf(store, 'bn_1');

    setBracketWinner(store, 'bn_1' as BracketNodeId, loser as GroupId);

    const entry = open(store).log.at(-1);
    expect(entry?.action).toBe('BRACKET_WINNER_SET');
    expect(entry?.payload.discarded).toHaveLength(2);
  });

  it('gives every discarded result back in one press of Rückgängig', () => {
    const store = played();
    const before = bracketOf(store);
    const [, loser] = slotsOf(store, 'bn_1');
    setBracketWinner(store, 'bn_1' as BracketNodeId, loser as GroupId);

    expect(store.undo()).toBe(true);

    expect(bracketOf(store)).toEqual(before);
  });
});

describe('finishBracket', () => {
  it('moves into the Siegerehrung once the tree is over', () => {
    const store = ready(readyToDraw(2, 1));
    drawBracket(store);
    const final = bracketOf(store).nodes[0];
    setBracketWinner(store, final?.id as BracketNodeId, final?.slotA as GroupId);

    finishBracket(store);

    expect(open(store).phase).toBe('CEREMONY');
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.bracketFinished);
    expect(open(store).log.at(-1)?.action).toBe('BRACKET_FINISHED');
  });

  /*
   * docs/TOURNAMENT-RULES.md §8: the podium is the host's to reveal, and must
   * never appear the instant the final is decided.
   */
  it('leaves the projector showing the finished tree', () => {
    const store = ready(readyToDraw(2, 1));
    drawBracket(store);
    const final = bracketOf(store).nodes[0];
    setBracketWinner(store, final?.id as BracketNodeId, final?.slotA as GroupId);

    finishBracket(store);

    expect(store.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('commits nothing while a match is still open', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const before = store.getState().revision;

    finishBracket(store);

    expect(store.getState().revision).toBe(before);
  });
});

describe('showBracketOnBeamer', () => {
  it('zooms the projector to a round, and back to the whole tree', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);

    showBracketOnBeamer(store, 'FINAL');
    expect(store.getState().scene).toEqual({ id: 'BRACKET', focus: 'FINAL' });

    showBracketOnBeamer(store, null);
    expect(store.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('takes the beamer by hand, like every other scene change', () => {
    const store = ready(readyToDraw(4));

    showBracketOnBeamer(store, 'SEMI_FINAL');

    expect(store.getState().autoFollow).toBe(false);
  });
});

describe('startNextBracketMatch', () => {
  it('puts the waiting match on the freed table and logs the queue behind it', () => {
    const store = ready(readyToDraw(8, 1));
    drawBracket(store);
    const first = bracketOf(store).nodes[0];
    setBracketWinner(store, first?.id as BracketNodeId, first?.slotA as GroupId);

    startNextBracketMatch(store, tableId(1));

    expect(open(store).tables[0]?.currentMatchId).toBe('bn_2');
    expect(bracketOf(store).nodes[1]?.tableId).toBe(tableId(1));
    const entry = open(store).log.at(-1);
    expect(entry?.action).toBe('BRACKET_MATCH_ASSIGNED');
    expect(entry?.payload).toMatchObject({ tableId: 'tbl_1', nodeId: 'bn_2', queued: 3 });
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.matchStarted({ table: 'Table 1' }),
    );
  });

  it('commits nothing when there is nothing waiting', () => {
    const store = ready(readyToDraw(4));
    drawBracket(store);
    const before = store.getState().revision;

    startNextBracketMatch(store, tableId(1));

    expect(store.getState().revision).toBe(before);
  });
});
