import { describe, expect, it } from 'vitest';

import { closeRound, drawRound, roundOutcome, setWinner } from '@/domain/draw';
import {
  acceptCandidate,
  declineCandidate,
  drawCandidate,
  repechageState,
  startRepechage,
  useRepechageFallback,
} from '@/domain/repechage';
import { currentRound } from '@/domain/selectors';
import { snapshotSchema, toTournamentSnapshot, type Snapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';

/**
 * The `Hoffnungsrunde` on its way to the projector (issue #21).
 *
 * The scene holds no state of its own (CLAUDE.md golden rule 4), so everything
 * it draws has to survive this projection and the wire format behind it. What
 * is checked here is the part the room would notice if it did not: the counter,
 * the winners column, and a pot in which nobody has gone missing.
 */

/** A tournament whose qualifying round has been drawn, decided and closed. */
function qualified(groups: number, tables = 2): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => `Round ${index}` });
  let decided = drawn;
  for (const match of openRound(drawn).matches) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

function openRound(document: Tournament): Round {
  const round = currentRound(document) ?? document.rounds[0];
  if (round === undefined) {
    throw new Error('nothing was drawn');
  }
  return round;
}

/** 13 groups: 6 winners plus a bye is 7, so the target is 8 and one is owed. */
function inRepechage(): Tournament {
  return startRepechage(qualified(13));
}

function answer(document: Tournament, accepted: boolean): Tournament {
  const drawn = drawCandidate(document);
  return accepted ? acceptCandidate(drawn) : declineCandidate(drawn);
}

const projected = (document: Tournament) => toTournamentSnapshot(document).repechage;

function wire(document: Tournament): Snapshot {
  const sent: Snapshot = {
    revision: 1,
    scene: { id: 'REPECHAGE' },
    autoFollow: true,
    skipToken: 0,
    tournament: toTournamentSnapshot(document),
    delivery: 'live',
  };
  return snapshotSchema.parse(JSON.parse(JSON.stringify(sent)));
}

describe('the repechage in a snapshot', () => {
  it('is absent for a tournament that has not reached the phase', () => {
    expect(projected(qualified(13))).toBeNull();
  });

  /*
   * The skip of docs/TOURNAMENT-RULES.md §9 case 2, seen from the projector: 16
   * groups leave 8 winners, which is already a power of two. Null is what tells
   * the scene to draw nothing at all rather than an empty pot — the phase is
   * skipped *invisibly*, which is issue #21's third acceptance criterion.
   */
  it('is absent for a field that skips the phase', () => {
    expect(projected(qualified(16))).toBeNull();
  });

  it('carries the target and the places still open', () => {
    const started = inRepechage();

    expect(projected(started)).toMatchObject({ target: 8, need: 1, byes: 0, complete: false });
  });

  it('carries the winners column, so the room can see the field fill up', () => {
    const started = inRepechage();
    const winners = roundOutcome(openRound(started)).winners;

    expect(projected(started)?.through).toEqual([...winners]);
    expect(projected(answer(started, true))?.through).toHaveLength(winners.length + 1);
  });

  it('carries every loser, before and after every answer', () => {
    const started = inRepechage();
    const losers = roundOutcome(openRound(started)).losers.length;

    expect(projected(started)?.pot).toHaveLength(losers);
    expect(projected(drawCandidate(started))?.pot).toHaveLength(losers);
    expect(projected(answer(started, true))?.pot).toHaveLength(losers);
    expect(projected(answer(started, false))?.pot).toHaveLength(losers);
  });

  it('names the card that is moving, and what became of it', () => {
    const drawn = drawCandidate(inRepechage());
    const pending = repechageState(drawn)?.pending;

    expect(projected(drawn)?.last).toEqual({ groupId: pending, accepted: null });
    expect(projected(acceptCandidate(drawn))?.last).toEqual({ groupId: pending, accepted: true });
    expect(projected(declineCandidate(drawn))?.last).toEqual({
      groupId: pending,
      accepted: false,
    });
  });

  it('reports the field as complete once the last place is taken', () => {
    const filled = answer(inRepechage(), true);

    expect(projected(filled)).toMatchObject({ need: 0, complete: true });
  });

  /*
   * The `Freilose` of §4's first fallback are places in the field that nobody
   * is standing in. The scene says so out loud, so it needs the count: a
   * winners column that came up short against the target with no explanation is
   * how a room decides the app has miscounted.
   */
  it('carries the Freilose the fallback owes the next round', () => {
    let document = inRepechage();
    while ((repechageState(document)?.pool.length ?? 0) > 0) {
      document = answer(document, false);
    }

    const withByes = useRepechageFallback(document, 'BYES');

    expect(projected(withByes)).toMatchObject({ byes: 1, need: 0, fallbackUsed: 'BYES' });
  });

  /**
   * A beamer reopened mid-phase is handed the picture in one message, and the
   * message is JSON. Everything above has to come back out of it unchanged, or
   * the projector shows a different pot than the host is reading (CLAUDE.md §7,
   * "the beamer picture is correct after closing and reopening").
   */
  it('survives the wire format unchanged', () => {
    const drawn = drawCandidate(answer(inRepechage(), false));

    expect(wire(drawn).tournament.repechage).toEqual(projected(drawn));
  });
});
