import { beforeAll, describe, expect, it } from 'vitest';

import { bracketRoundForSize } from '@/domain/bracket';
import { rematchIds } from '@/domain/history';
import { matchIdSchema } from '@/domain/ids';
import type { Phase, RepechageFallback, Tournament } from '@/domain/types';
import {
  decidedResults,
  occupancy,
  reopenBeamer,
  restartFromDisk,
  undoableShape,
  undoRedo,
} from '@/qa/checks';
import { runDryRun, type DryRunReport, type DryRunSpec, type RepechagePolicy } from '@/qa/dryRun';
import { toSnapshot, type TournamentStore } from '@/store/tournamentStore';

/**
 * The dry runs of issue #33, as far as a machine can take them.
 *
 * Each scenario plays a whole evening through the real store and, **after every
 * single host action**, does the three things that go wrong at a live event:
 * kills the app and reopens the file, kills the beamer window and reopens it,
 * and — once per phase — takes the last five decisions back and puts them
 * again. A check that ran only at the end of a scenario would miss exactly the
 * states a real failure happens in, which is halfway through a round with two
 * tables occupied and a queue behind them.
 *
 * What is deliberately **not** here, because no test can do it, is in
 * docs/QA-DRY-RUNS.md: a projector, ten metres of room, a cable pulled out of a
 * socket, and a pair of eyes. That document is the other half of this file and
 * they are meant to be read together.
 */

/** How far back the misclick check reaches — the issue asks for five. */
const UNDO_STEPS = 5;

/** Which action of a phase the misclick lands on. Deep enough that tables are busy. */
const UNDO_PROBE_AT = 6;

/**
 * The host declines nearly everybody, which is what forces §4's fallback.
 *
 * Both answers get exercised in one run: the pot runs dry, the host readmits the
 * declined (*Ausgeschiedene erneut zulassen*), most of them say no a second
 * time, and the places that are still open become `Freilose`.
 */
const DECLINE_HEAVY: RepechagePolicy = {
  accepts: (drawIndex) => drawIndex >= 18,
  fallback: (attempt) => (attempt === 1 ? 'REOPEN_DECLINED' : 'BYES'),
};

interface Expected {
  /** The phases §1 says this shape of tournament passes through, in order. */
  phases: readonly Phase[];
  bracketSize: number;
  /** §9 case 10: every bracket but the two-slot one has a `Spiel um Platz 3`. */
  thirdPlace: boolean;
  /** Null where §9 case 2 skips the phase entirely. */
  repechage: { target: number; fallbackUsed: RepechageFallback | null } | null;
  /** The least queueing this scenario is meant to exercise (§9 case 3). */
  minPeakQueue: number;
  /** The fewest `Freilose` it must hand out (§9 case 1). */
  minByes: number;
  /** How many rounds are drawn before the naming phase. */
  rounds: number;
}

interface Scenario {
  /** Names the run in the report and in docs/QA-DRY-RUNS.md. */
  id: string;
  /** What the issue says this scenario is for. */
  purpose: string;
  spec: DryRunSpec;
  expected: Expected;
}

const WITH_REPECHAGE: readonly Phase[] = [
  'SETUP',
  'QUALIFYING',
  'REPECHAGE',
  'NAMING',
  'BRACKET',
  'CEREMONY',
];

const SCENARIOS: readonly Scenario[] = [
  {
    id: '5-groups-2-tables',
    purpose: 'odd count, Freilos, tables below matches, final phase at 4',
    spec: { id: '5-groups-2-tables', groups: 5, tables: 2 },
    expected: {
      phases: WITH_REPECHAGE,
      bracketSize: 4,
      thirdPlace: true,
      repechage: { target: 4, fallbackUsed: null },
      minPeakQueue: 0,
      minByes: 1,
      rounds: 1,
    },
  },
  {
    id: '13-groups-3-tables',
    purpose: 'Freilos, repechage 7 to 8, no elimination round, queueing',
    spec: { id: '13-groups-3-tables', groups: 13, tables: 3 },
    expected: {
      phases: WITH_REPECHAGE,
      bracketSize: 8,
      thirdPlace: true,
      repechage: { target: 8, fallbackUsed: null },
      minPeakQueue: 1,
      minByes: 1,
      rounds: 1,
    },
  },
  {
    id: '40-groups-6-tables',
    purpose: 'repechage 20 to 32, one elimination round to 16, full bracket, heavy queueing',
    spec: { id: '40-groups-6-tables', groups: 40, tables: 6 },
    expected: {
      phases: ['SETUP', 'QUALIFYING', 'REPECHAGE', 'ELIMINATION', 'NAMING', 'BRACKET', 'CEREMONY'],
      bracketSize: 16,
      thirdPlace: true,
      repechage: { target: 32, fallbackUsed: null },
      minPeakQueue: 10,
      minByes: 0,
      rounds: 2,
    },
  },
  {
    id: '2-groups-1-table',
    purpose: 'degenerate case: one match, no qualifying round, no third-place match',
    spec: { id: '2-groups-1-table', groups: 2, tables: 1 },
    expected: {
      phases: ['SETUP', 'QUALIFYING', 'NAMING', 'BRACKET', 'CEREMONY'],
      bracketSize: 2,
      thirdPlace: false,
      repechage: null,
      minPeakQueue: 0,
      minByes: 0,
      rounds: 0,
    },
  },
  {
    id: 'decline-heavy',
    purpose: 'most repechage candidates decline, forcing both of the §4 fallbacks',
    spec: { id: 'decline-heavy', groups: 20, tables: 4, repechage: DECLINE_HEAVY },
    expected: {
      phases: WITH_REPECHAGE,
      bracketSize: 16,
      thirdPlace: true,
      repechage: { target: 16, fallbackUsed: 'BYES' },
      minPeakQueue: 5,
      minByes: 1,
      rounds: 1,
    },
  },
];

/** What one scenario proved, beyond the report the runner hands back. */
interface Audit {
  report: DryRunReport;
  /** Phases in which the app was killed and reopened on its own file. */
  recoveredIn: ReadonlySet<Phase>;
  /** Phases in which the beamer window was closed and reopened. */
  beamerIn: ReadonlySet<Phase>;
  /** Phases in which five decisions were taken back and put again. */
  undoneIn: ReadonlySet<Phase>;
  /** How many host actions each phase cost. */
  actionsPerPhase: ReadonlyMap<Phase, number>;
  /** Steps taken by the undo probe at the very end of the evening. */
  finalUndoSteps: number;
  /** The tournament as the evening left it, for the checks that read it whole. */
  final: Tournament | null;
}

async function audit(spec: DryRunSpec): Promise<Audit> {
  /** Every state the host has been in, in order, so an undo has a target. */
  const history: Tournament[] = [];
  const recoveredIn = new Set<Phase>();
  const beamerIn = new Set<Phase>();
  const undoneIn = new Set<Phase>();
  const actionsPerPhase = new Map<Phase, number>();
  let host: TournamentStore | null = null;

  const report = await runDryRun(spec, {
    async afterAction({ event, store, disk }) {
      host = store;
      const state = store.getState();
      const document = state.document;
      expect(document).not.toBeNull();
      if (document === null) {
        return;
      }
      history.push(document);
      const seen = (actionsPerPhase.get(event.phase) ?? 0) + 1;
      actionsPerPhase.set(event.phase, seen);

      // The laptop dies right here. Everything the host has decided has to come
      // back off the file the autosave wrote — including which table each match
      // was on, which is what the room is physically looking at.
      expect(state.file).toEqual({ status: 'saved', path: disk.path });
      const restored = await restartFromDisk(disk);
      expect(restored.document).toEqual(document);
      expect(decidedResults(restored.document)).toEqual(decidedResults(document));
      expect(occupancy(restored.document)).toEqual(occupancy(document));
      // And the picture rebuilt from the file is the picture the host was
      // broadcasting, so the beamer comes back to the same scene (golden rule 4).
      expect(restored.snapshot).toEqual(state.tournament);
      recoveredIn.add(event.phase);

      // The beamer window is closed and opened again. It must be handed the
      // current picture, settled — never replayed.
      const view = await reopenBeamer(store);
      expect(view.snapshot).toEqual(toSnapshot(state, 'catchUp'));
      expect(view.animate).toBe(false);
      beamerIn.add(event.phase);

      // Once per phase, deep enough in that tables are occupied: the host
      // misclicks, presses *Rückgängig* five times, and then puts it all back.
      if (seen === UNDO_PROBE_AT && probeUndo(store, history, history.length - 1) > 0) {
        undoneIn.add(event.phase);
      }
    },
  });

  // And once more with the evening over, so a scenario too short for any phase
  // to reach `UNDO_PROBE_AT` — two participants and one table — is still asked
  // the question the issue asks of every scenario.
  const finalUndoSteps = probeUndo(host, history, history.length - 1);

  return {
    report,
    recoveredIn,
    beamerIn,
    undoneIn,
    actionsPerPhase,
    finalUndoSteps,
    final: history.at(-1) ?? null,
  };
}

/**
 * Takes `UNDO_STEPS` decisions back, checks the tournament is the one the host
 * was looking at five actions ago, and puts them all back again.
 *
 * Both directions, because the round trip is what makes this safe to run in the
 * middle of a scenario that has to carry on afterwards — and because a redo
 * that does not restore what the undo took away is the same bug seen from the
 * other end.
 */
function probeUndo(
  store: TournamentStore | null,
  history: readonly Tournament[],
  at: number,
): number {
  const now = history[at];
  const then = history[at - UNDO_STEPS];
  if (store === null || now === undefined || then === undefined) {
    return 0;
  }

  const trip = undoRedo(store, UNDO_STEPS);
  expect(trip.steps).toBe(UNDO_STEPS);
  expect(undoableShape(trip.afterUndo)).toEqual(undoableShape(then));
  expect(occupancy(trip.afterUndo)).toEqual(occupancy(then));
  expect(undoableShape(trip.afterRedo)).toEqual(undoableShape(now));
  expect(occupancy(trip.afterRedo)).toEqual(occupancy(now));
  return trip.steps;
}

const results = new Map<string, Audit>();

describe.each(SCENARIOS)('$id — $purpose', (scenario) => {
  let run: Audit;

  beforeAll(async () => {
    run = await audit(scenario.spec);
    results.set(scenario.id, run);
  }, 120_000);

  it('completes without a workaround', () => {
    expect(run.report.standings?.first).not.toBeNull();
    expect(run.report.phases.at(-1)).toBe('CEREMONY');
  });

  it('passes through exactly the phases §1 promises, in order', () => {
    expect(run.report.phases).toEqual(scenario.expected.phases);
  });

  it('never advances a phase without a host action', () => {
    // `runDryRun` throws the moment any other action moves the phase, so
    // reaching this line is already the check. What is asserted here is the
    // other half: every transition after `SETUP` was paid for by one of the
    // four actions a host presses to make it happen.
    const movers = run.report.events.filter((event) =>
      ['PHASE_ADVANCED', 'TOURNAMENT_STARTED', 'BRACKET_DRAWN', 'BRACKET_FINISHED'].includes(
        event.action,
      ),
    );
    expect(movers).toHaveLength(scenario.expected.phases.length - 1);
  });

  it('draws the rounds the shape of the field calls for', () => {
    expect(run.report.rounds).toHaveLength(scenario.expected.rounds);
  });

  it('builds the bracket the field size earns (§7, §9 case 10)', () => {
    expect(run.report.bracketSize).toBe(scenario.expected.bracketSize);
    expect(run.report.hasThirdPlaceMatch).toBe(scenario.expected.thirdPlace);
    expect(run.report.standings?.third === null).toBe(!scenario.expected.thirdPlace);
  });

  it('runs the Hoffnungsrunde only where §4 needs one', () => {
    const expected = scenario.expected.repechage;
    if (expected === null) {
      expect(run.report.repechage).toBeNull();
      return;
    }
    expect(run.report.repechage?.target).toBe(expected.target);
    expect(run.report.repechage?.fallbackUsed).toBe(expected.fallbackUsed);
    // The invariant at the bottom of §4: the field the bracket is built on is a
    // power of two, `Freilose` included.
    const size = run.report.repechage?.target ?? 0;
    expect(Number.isInteger(Math.log2(size))).toBe(true);
  });

  it('queues matches when there are fewer tables than pairs (§9 case 3)', () => {
    expect(run.report.peakQueue).toBeGreaterThanOrEqual(scenario.expected.minPeakQueue);
  });

  it('never draws the same two participants against each other twice (issue #72)', () => {
    // Over a whole evening, not only between consecutive rounds: a group put
    // back in by the `Hoffnungsrunde` could otherwise meet somebody from two
    // rounds ago (docs/TOURNAMENT-RULES.md §3).
    const document = run.final;
    expect(document).not.toBeNull();
    if (document === null) {
      return;
    }

    const repeated = rematchIds(document);
    const drawn = new Set(
      document.rounds.flatMap((each) => each.matches.map((entry) => String(entry.id))),
    );

    // Nothing a *draw* decided may repeat. A bracket round above the first can,
    // and that is the documented limitation of §7 — opponents there come from
    // who wins, not from a draw.
    expect([...repeated].filter((id) => drawn.has(String(id)))).toEqual([]);

    const firstBracketRound =
      document.bracket === null ? null : bracketRoundForSize(document.bracket.size);
    const repeatedNodes = (document.bracket?.nodes ?? []).filter((node) =>
      repeated.has(matchIdSchema.parse(node.id)),
    );
    expect(repeatedNodes.filter((node) => node.round === firstBracketRound)).toEqual([]);
  });

  it('hands out the Freilose the counts earn (§9 case 1)', () => {
    expect(run.report.byes).toBeGreaterThanOrEqual(scenario.expected.minByes);
  });

  it('recovers every decided result from a kill in every phase (§9 case 11)', () => {
    expect([...run.recoveredIn].sort()).toEqual([...scenario.expected.phases].sort());
  });

  it('hands a reopened beamer the settled current picture (§9 case 12)', () => {
    expect([...run.beamerIn].sort()).toEqual([...scenario.expected.phases].sort());
  });

  it('takes back five actions wherever there are five to take back', () => {
    // Every phase that ran long enough was probed mid-phase, and the evening as
    // a whole was probed once more after the `Siegerehrung` — which is the only
    // probe a two-participant tournament is long enough to get.
    const deep = [...run.actionsPerPhase]
      .filter(([, count]) => count >= UNDO_PROBE_AT)
      .map(([phase]) => phase)
      .sort();
    expect([...run.undoneIn].sort()).toEqual(deep);
    expect(run.finalUndoSteps).toBe(UNDO_STEPS);
  });
});

describe('the five scenarios together', () => {
  it('covers every edge case the issue names', () => {
    expect(results.size).toBe(SCENARIOS.length);

    const reports = [...results.values()].map((run) => run.report);
    // §9 case 1 — a Freilos happens.
    expect(reports.some((report) => report.byes > 0)).toBe(true);
    // §9 case 2 — a field that is already a power of two skips the phase.
    expect(reports.some((report) => report.repechage === null)).toBe(true);
    // §9 case 3 — matches queue behind the tables.
    expect(reports.some((report) => report.peakQueue > 0)).toBe(true);
    // §9 cases 6 and 7 — the pot runs dry and the host is offered the fallback.
    expect(reports.some((report) => report.repechage?.fallbackUsed !== null)).toBe(true);
    // §9 case 10 — the final phase is reached at 16, at 8, at 4 and at 2.
    expect(new Set(reports.map((report) => report.bracketSize))).toEqual(new Set([16, 8, 4, 2]));
  });

  /**
   * The one number issue #33 asks for outright.
   *
   * Printed rather than asserted, because it is a model and not a measurement —
   * `pnpm qa:dry-run` shows it, and docs/QA-DRY-RUNS.md states the assumptions
   * it rests on. What *is* asserted is that the arithmetic still reaches the
   * report at all, so the numbers in that document cannot quietly become stale.
   */
  it('reports how long each evening takes', () => {
    const rows = [...results.values()].map(({ report }) => ({
      scenario: report.id,
      groups: report.spec.groups,
      tables: report.spec.tables,
      phases: report.phases.join(' → '),
      rounds: report.rounds.map((round) => `${round.label}: ${round.matches}`).join(', '),
      matches: report.matchesPlayed,
      byes: report.byes,
      peakQueue: report.peakQueue,
      repechage:
        report.repechage === null
          ? 'skipped'
          : `${report.repechage.target} (drawn ${report.repechage.drawn}, ` +
            `accepted ${report.repechage.accepted}, declined ${report.repechage.declined}, ` +
            `fallback ${report.repechage.fallbackUsed ?? 'none'})`,
      bracket: report.bracketSize,
      hostActions: report.hostActions,
      minutes: Math.round(report.totalMs / 60_000),
    }));
    console.log(JSON.stringify(rows, null, 2));

    for (const row of rows) {
      expect(row.minutes).toBeGreaterThan(0);
      expect(row.hostActions).toBeGreaterThan(0);
    }
  });
});
