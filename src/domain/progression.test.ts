import { describe, expect, it } from 'vitest';

import {
  byesOwed,
  canDrawRound,
  closeRound,
  drawBlockers,
  drawRound,
  fieldSize,
  roundOutcome,
  setWinner,
} from '@/domain/draw';
import { addGroups } from '@/domain/groups';
import {
  advancePhase,
  canAdvancePhase,
  carriedField,
  nextPhase,
  phaseStep,
} from '@/domain/progression';
import {
  acceptCandidate,
  declineCandidate,
  drawCandidate,
  isRepechageComplete,
  repechageState,
  useRepechageFallback,
} from '@/domain/repechage';
import { nextPowerOfTwo } from '@/domain/round';
import { startTournament } from '@/domain/start';
import { addTables } from '@/domain/tables';
import { FIXED_NOW, tournament } from '@/domain/testFixtures';
import { tournamentSchema, type Phase, type Round, type Tournament } from '@/domain/types';

/**
 * Round progression until the final phase (issue #22,
 * docs/TOURNAMENT-RULES.md §1 and §5).
 *
 * The cases the issue names are whole tournaments rather than single calls, so
 * most of this file is driven by `play`, which runs an evening end to end: draw,
 * decide, close, step, repeat. That is deliberate — the acceptance criterion is
 * that *no configuration of group count can produce an unreachable or stuck
 * phase*, and the only honest way to check it is to play the configuration and
 * see where it ends up.
 *
 * The driver never advances the phase on its own. Every step it takes is one a
 * host would have had to press, and `play` records them, so "nothing advances
 * without an explicit host action" is a property of the harness as well as of
 * the code under it.
 */

const roundLabel = (index: number) => `Runde ${index}`;
const tableLabel = (n: number) => `Tisch ${n}`;
const draw = { at: FIXED_NOW, label: roundLabel };

/** A tournament in `QUALIFYING` with `groups` participants and `tables` tables. */
function ready(groups: number, tables = 4): Tournament {
  return startTournament(
    addTables(addGroups(tournament(), groups), { count: tables, label: tableLabel }),
  );
}

interface Played {
  document: Tournament;
  /** Every phase the tournament stood in, in order, starting at `QUALIFYING`. */
  phases: Phase[];
  /** Every round that was drawn, in order. */
  rounds: Round[];
  /** How many host decisions the evening took, as a guard against a loop. */
  steps: number;
}

/**
 * Plays a whole evening the way a host would, and stops when nothing is left to
 * press.
 *
 * `declines` is how many repechage candidates say no before the rest accept,
 * which is the only way to reach §4's fallback — everything else about the
 * evening is decided by the group count.
 */
function play(groupCount: number, { tables = 4, declines = 0 } = {}): Played {
  let document = ready(groupCount, tables);
  const phases: Phase[] = [document.phase];
  const rounds: Round[] = [];
  let declined = 0;
  let steps = 0;

  // A hard ceiling rather than `while (true)`: a phase machine that cannot make
  // progress must fail this test as a loop that ran out, not by hanging the
  // suite.
  for (; steps < 200; steps += 1) {
    if (document.phase === 'REPECHAGE' && !isRepechageComplete(document)) {
      const state = repechageState(document);
      if (state === null) {
        break;
      }
      if (state.pending !== null) {
        // The first `declines` candidates say no; everybody after them accepts.
        // Draining the pot is the only way to reach §4's fallback.
        document = declined < declines ? declineCandidate(document) : acceptCandidate(document);
        declined += 1;
      } else if (state.pool.length > 0) {
        document = drawCandidate(document);
      } else {
        // *Freilose vergeben*: §4's default, and the one answer that is always
        // available, which is what makes this phase impossible to get stuck in.
        document = useRepechageFallback(document, 'BYES');
      }
      continue;
    }

    if (canDrawRound(document)) {
      const drawn = drawRound(document, draw);
      const round = drawn.rounds.at(-1);
      if (round !== undefined) {
        rounds.push(round);
      }
      document = closeRound(decideEverything(drawn));
      continue;
    }

    if (canAdvancePhase(document)) {
      document = advancePhase(document);
      phases.push(document.phase);
      continue;
    }

    break;
  }

  return { document, phases, rounds, steps };
}

/** Every real match decided in favour of the group drawn first. */
function decideEverything(document: Tournament): Tournament {
  const round = document.rounds.at(-1);
  if (round === undefined) {
    return document;
  }
  return round.matches.reduce(
    (next, match) => (match.b === null ? next : setWinner(next, match.id, match.a)),
    document,
  );
}

/**
 * How many the evening leaves standing for the bracket: the groups still in,
 * plus any `Freilose` §4 owed that no round was left to hand out.
 */
function finalField(played: Played): number {
  return fieldSize(played.document);
}

// ---------------------------------------------------------------------------

describe('the phase machine', () => {
  /*
   * The table of docs/TOURNAMENT-RULES.md §1, read back one arrow at a time. It
   * is checked against field sizes rather than against tournaments so the shape
   * of the machine is visible in one place — a phase that lost its exit would
   * fail here rather than in a tournament that happens to reach it.
   */
  it('follows §1 from setup to the ceremony', () => {
    expect(nextPhase('SETUP', 40)).toBe('QUALIFYING');
    expect(nextPhase('NAMING', 16)).toBe('BRACKET');
    expect(nextPhase('BRACKET', 16)).toBe('CEREMONY');
    expect(nextPhase('CEREMONY', 16)).toBeNull();
  });

  it('sends a field that is not a power of two to the Hoffnungsrunde', () => {
    expect(nextPhase('QUALIFYING', 20)).toBe('REPECHAGE');
    expect(nextPhase('QUALIFYING', 7)).toBe('REPECHAGE');
  });

  /* §9 case 2: the phase is skipped, not shown empty. */
  it('skips the Hoffnungsrunde for a field that is already a power of two', () => {
    expect(nextPhase('QUALIFYING', 32)).toBe('ELIMINATION');
    expect(nextPhase('QUALIFYING', 8)).toBe('NAMING');
  });

  it('starts the final phase at the size the field reached', () => {
    expect(nextPhase('REPECHAGE', 32)).toBe('ELIMINATION');
    expect(nextPhase('REPECHAGE', 16)).toBe('NAMING');
    expect(nextPhase('REPECHAGE', 8)).toBe('NAMING');
    expect(nextPhase('REPECHAGE', 2)).toBe('NAMING');
  });

  /*
   * The `while |W| > 16` loop. Null is the loop going round again — the host
   * draws, the field halves, and the same question is asked of half of it.
   */
  it('keeps the elimination rounds going while more than sixteen are in', () => {
    expect(nextPhase('ELIMINATION', 64)).toBeNull();
    expect(nextPhase('ELIMINATION', 32)).toBeNull();
    expect(nextPhase('ELIMINATION', 16)).toBe('NAMING');
    expect(nextPhase('ELIMINATION', 4)).toBe('NAMING');
  });

  /*
   * The acceptance criterion, checked exhaustively rather than by example: from
   * two participants to sixty-four, every evening ends in the naming phase with
   * a power-of-two field a bracket can be built on.
   */
  it.each(Array.from({ length: 63 }, (_, index) => index + 2))(
    'takes %i participants to a bracket-shaped final phase',
    (count) => {
      const played = play(count);
      const field = finalField(played);

      expect(played.document.phase).toBe('NAMING');
      expect(field).toBe(nextPowerOfTwo(field));
      expect(field).toBeGreaterThanOrEqual(2);
      expect(field).toBeLessThanOrEqual(16);
      // The evening finished rather than running out of steps.
      expect(played.steps).toBeLessThan(199);
      expect(() => tournamentSchema.parse(played.document)).not.toThrow();
    },
  );
});

describe('the evenings the issue names', () => {
  /* 40 groups: 20 winners → repechage to 32 → 16 → final phase at 16. */
  it('takes 40 participants through the Hoffnungsrunde and one elimination round', () => {
    const played = play(40);

    expect(played.rounds.map((round) => round.matches.length)).toEqual([20, 16]);
    expect(played.rounds.map((round) => round.kind)).toEqual(['QUALIFYING', 'ELIMINATION']);
    expect(played.phases).toEqual(['QUALIFYING', 'REPECHAGE', 'ELIMINATION', 'NAMING']);
    expect(played.document.repechage?.target).toBe(32);
    expect(finalField(played)).toBe(16);
  });

  /* 13 groups: 7 winners → repechage to 8 → final phase at 8, no elimination. */
  it('takes 13 participants to a final phase of eight with no elimination round', () => {
    const played = play(13);

    expect(played.rounds.map((round) => round.matches.length)).toEqual([7]);
    expect(played.phases).toEqual(['QUALIFYING', 'REPECHAGE', 'NAMING']);
    expect(played.rounds.some((round) => round.kind === 'ELIMINATION')).toBe(false);
    expect(played.document.repechage?.target).toBe(8);
    expect(finalField(played)).toBe(8);
  });

  /*
   * 2 groups: docs/TOURNAMENT-RULES.md §9 case 5. The one match there is to play
   * is the `Finale` itself, so no qualifying round is drawn — one would leave a
   * single group and a bracket of one (docs/OPEN-QUESTIONS.md #62).
   */
  it('sends 2 participants straight to naming for a final phase of two', () => {
    const played = play(2);

    expect(played.rounds).toHaveLength(0);
    expect(played.phases).toEqual(['QUALIFYING', 'NAMING']);
    expect(finalField(played)).toBe(2);
    expect(drawBlockers(ready(2))).toEqual(['FINAL_PHASE_REACHED']);
  });

  /* 64 groups: 32 → 16 → final phase, exactly one elimination round. */
  it('takes 64 participants through exactly one elimination round', () => {
    const played = play(64);

    expect(played.rounds.map((round) => round.matches.length)).toEqual([32, 16]);
    expect(played.rounds.filter((round) => round.kind === 'ELIMINATION')).toHaveLength(1);
    // The field was a power of two at the close of round 1, so §4 never ran.
    expect(played.phases).toEqual(['QUALIFYING', 'ELIMINATION', 'NAMING']);
    expect(played.document.repechage).toBeNull();
    expect(finalField(played)).toBe(16);
  });
});

/*
 * docs/TOURNAMENT-RULES.md §4, fallback 1: the pot ran dry with places still
 * open, so the missing places become `Freilose` — and it is the **next draw**
 * that hands them out. A field of 20 short of 32 owes twelve of them, and the
 * round drawn from it has to be sixteen matches: four real pairs and twelve
 * byes. Handing out only the single bye an odd count earns would produce a
 * field the bracket cannot use.
 */
describe('Freilose owed by the repechage fallback', () => {
  it('carries every owed Freilos into the next round', () => {
    // Everybody declines, so the pot empties with twelve places open.
    const played = play(40, { declines: 20 });
    const elimination = played.rounds.at(-1);

    expect(played.document.repechage?.fallbackUsed).toBe('BYES');
    expect(elimination?.kind).toBe('ELIMINATION');
    expect(elimination?.matches).toHaveLength(16);
    expect(elimination?.matches.filter((match) => match.b === null)).toHaveLength(12);
    // Twelve byes and four decided pairs is sixteen winners — the field the
    // final phase starts at.
    expect(finalField(played)).toBe(16);
    expect(played.document.phase).toBe('NAMING');
  });

  it('counts the debt until the round that settles it is drawn', () => {
    let document = ready(40);
    document = closeRound(decideEverything(drawRound(document, draw)));
    document = advancePhase(document);

    // Drain the pot without accepting anybody, then take the fallback.
    for (let index = 0; index < 20; index += 1) {
      document = declineCandidate(drawCandidate(document));
    }
    document = useRepechageFallback(document, 'BYES');

    expect(byesOwed(document)).toBe(12);
    expect(fieldSize(document)).toBe(32);

    document = advancePhase(document);
    expect(document.phase).toBe('ELIMINATION');
    expect(byesOwed(document)).toBe(12);

    // Settled by the draw, and never handed out twice.
    document = drawRound(document, draw);
    expect(byesOwed(document)).toBe(0);
    expect(fieldSize(document)).toBe(20);
  });

  it('leaves the debt to the bracket when the target is already the final phase', () => {
    // 13 leaves 7 standing and a target of 8; everybody declines, so one place
    // becomes a `Freilos` and there is no elimination round to hand it out in.
    const played = play(13, { declines: 6 });

    expect(played.document.repechage?.fallbackUsed).toBe('BYES');
    expect(played.document.phase).toBe('NAMING');
    expect(played.rounds).toHaveLength(1);
    expect(repechageState(played.document)?.byes).toBe(1);
  });
});

describe('what the host is shown before they press', () => {
  it('names the phase ahead from the moment the round is drawn', () => {
    const drawn = drawRound(ready(40), draw);
    const step = phaseStep(drawn);

    // Twenty pairings, so twenty winners, so a target of 32 — known before a
    // single result is in (docs/OPEN-QUESTIONS.md #52).
    expect(step?.to).toBe('REPECHAGE');
    expect(step?.field).toBe(20);
    expect(step?.blockers).toEqual(['ROUND_OPEN']);
    expect(step?.canAdvance).toBe(false);
  });

  it('refuses to move on while the round has not been drawn', () => {
    const undrawn = ready(40);

    expect(phaseStep(undrawn)?.blockers).toEqual(['ROUND_NOT_DRAWN']);
    expect(advancePhase(undrawn)).toBe(undrawn);
  });

  it('refuses to move on while the Hoffnungsrunde has places left', () => {
    const closed = closeRound(decideEverything(drawRound(ready(40), draw)));
    const running = advancePhase(closed);
    const step = phaseStep(running);

    expect(running.phase).toBe('REPECHAGE');
    expect(step?.blockers).toEqual(['REPECHAGE_OPEN']);
    expect(advancePhase(running)).toBe(running);
  });

  it('asks for another elimination round while more than sixteen are in', () => {
    const closed = closeRound(decideEverything(drawRound(ready(64), draw)));
    const eliminating = advancePhase(closed);
    const step = phaseStep(eliminating);

    expect(eliminating.phase).toBe('ELIMINATION');
    expect(step?.to).toBe('NAMING');
    expect(step?.field).toBe(32);
    expect(step?.blockers).toEqual(['FIELD_TOO_LARGE']);
    expect(advancePhase(eliminating)).toBe(eliminating);
  });

  it('refuses to move on while an elimination round is still open', () => {
    const closed = closeRound(decideEverything(drawRound(ready(64), draw)));
    const drawn = drawRound(advancePhase(closed), draw);
    const step = phaseStep(drawn);

    // The round is drawn, so the field it will hand on is already 16 — but it
    // has not been played, and a phase that moved on now would leave sixteen
    // pairs on the tables.
    expect(step?.field).toBe(16);
    expect(step?.blockers).toEqual(['ROUND_OPEN']);
    expect(advancePhase(drawn)).toBe(drawn);

    const played = closeRound(decideEverything(drawn));
    expect(phaseStep(played)?.canAdvance).toBe(true);
    expect(advancePhase(played).phase).toBe('NAMING');
  });

  /*
   * The phase change *is* the shuffle (docs/OPEN-QUESTIONS.md #54), so the step
   * into the `Hoffnungsrunde` has to leave a pot behind it — a `REPECHAGE`
   * phase with nothing in it is a projector with nothing to draw.
   */
  it('shuffles the pot in the same step as the phase change', () => {
    const closed = closeRound(decideEverything(drawRound(ready(40), draw)));
    const running = advancePhase(closed);

    expect(running.phase).toBe('REPECHAGE');
    expect(running.repechage?.target).toBe(32);
    expect(running.repechage?.pool).toHaveLength(20);
    expect(running.rngCursor).toBeGreaterThan(closed.rngCursor);
  });

  it('has no step to offer from the phases later issues own', () => {
    for (const phase of ['SETUP', 'NAMING', 'BRACKET', 'CEREMONY'] as const) {
      const document: Tournament = { ...ready(40), phase };

      expect(phaseStep(document)).toBeNull();
      expect(canAdvancePhase(document)).toBe(false);
      expect(advancePhase(document)).toBe(document);
    }
  });
});

describe('the field carried between phases', () => {
  it('is the pairings of the round, not the results so far', () => {
    const drawn = drawRound(ready(40), draw);
    const first = drawn.rounds[0]?.matches[0];
    const oneResult = first === undefined ? drawn : setWinner(drawn, first.id, first.a);

    // One winner is in and nineteen are not, and the number the host reads is
    // still the twenty the pairings promised (docs/OPEN-QUESTIONS.md #52).
    expect(roundOutcome(oneResult.rounds[0] as Round).winners).toHaveLength(1);
    expect(carriedField(oneResult)).toBe(20);
  });

  it('falls back to the groups still in for a phase that carries no round', () => {
    // `NAMING` onwards has no round of its own; what is standing is the field.
    const naming: Tournament = { ...ready(40), phase: 'NAMING' };

    expect(carriedField(naming)).toBe(40);
  });

  it('is the repechage target while the phase is running', () => {
    const closed = closeRound(decideEverything(drawRound(ready(40), draw)));
    const running = drawCandidate(advancePhase(closed));

    // Nineteen still in the pot, one on the beamer — and the number the host
    // plans around is still 32.
    expect(carriedField(running)).toBe(32);
  });
});
