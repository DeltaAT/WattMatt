import {
  finalStandings,
  isBracketComplete,
  nextQueuedBracketNode,
  type FinalStandings,
} from '@/domain/bracket';
import { canDrawRound, nextQueuedMatch, queuedMatches } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { canAdvancePhase } from '@/domain/progression';
import { repechageState, type RepechageState } from '@/domain/repechage';
import { createRng, type Rng } from '@/domain/rng';
import { activeGroups, currentRound, freeTables, undecidedMatches } from '@/domain/selectors';
import type { BracketNode, Match, Phase, RepechageFallback, Timestamp } from '@/domain/types';
import { toLocalTimestamp } from '@/platform/clock';
import {
  acceptRepechageCandidate,
  addGroups,
  addTables,
  advancePhase,
  closeRound,
  declineRepechageCandidate,
  drawBracket,
  drawRepechageCandidate,
  drawRound,
  finishBracket,
  setBracketWinner,
  setGroupName,
  setMatchWinner,
  startNextBracketMatch,
  startNextMatch,
  startTournament,
  useRepechageFallback,
} from '@/store/actions';
import { startAutosave, type Autosave } from '@/store/autosave';
import {
  autosaveTournament,
  createTournamentDocument,
  type PersistenceDeps,
} from '@/store/persistence';
import { fakeDeps, fakeFiles, type FakeFiles } from '@/store/testFixtures';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

/**
 * The scripted host of issue #33: a whole evening, driven through the real
 * store, one action at a time.
 *
 * This is the automatable half of the dry runs. It cannot look at a projector
 * from ten metres away, so it does not pretend to — what it does is play the
 * scenarios of the issue through the same actions the host window calls, in the
 * same order, and hand every intermediate state to the caller so the checks that
 * *can* be made mechanically are made against a real tournament rather than
 * against a fixture somebody wrote to pass. `docs/QA-DRY-RUNS.md` records which
 * half is which, and what is left for a human with a projector.
 *
 * Three properties make it worth trusting.
 *
 * **It only ever presses buttons.** Every mutation goes through
 * `@/store/actions`; nothing here writes a tournament by hand. A rule the
 * actions enforce is therefore a rule the dry run obeys, and one they let slip
 * is one it can catch.
 *
 * **A refused action is a failure, not a no-op.** Every action here is one the
 * panel would have offered, so a call that commits nothing means the app refused
 * something the host was entitled to do. `act` throws rather than carrying on,
 * which is what stops a scenario "passing" by quietly skipping the phase it was
 * written to exercise.
 *
 * **Nothing advances on its own.** The runner drives the phase machine with
 * explicit calls and checks, between every pair of actions, that the phase moved
 * only where one of the four transitions a host presses was taken. Golden rule 3
 * is the property this harness exists to hold the app to.
 */

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** A wall clock the caller winds forward by hand, for the timing model below. */
export interface SimulatedClock {
  now(): Timestamp;
  advance(ms: number): void;
  /** Milliseconds since the run started — the number the timing report uses. */
  elapsedMs(): number;
}

/** Seven in the evening, which is when a club evening actually starts. */
const DEFAULT_START = Date.UTC(2026, 8, 25, 17, 0, 0);

export function simulatedClock(startMs: number = DEFAULT_START): SimulatedClock {
  let at = startMs;
  return {
    now: () => toLocalTimestamp(new Date(at)),
    advance: (ms: number) => {
      at += ms;
    },
    elapsedMs: () => at - startMs,
  };
}

/**
 * How long the model says each thing takes.
 *
 * A model, and labelled as one wherever its numbers are quoted: a harness cannot
 * measure a room. What it can do is turn the question issue #33 asks — "how long
 * does a 40-group tournament actually take end to end?" — into arithmetic over
 * the real match count, the real queue depth and the real number of decisions the
 * host has to make, so the answer moves when the tournament shape does.
 * Substitute measured numbers here and the report becomes a measurement
 * (docs/QA-DRY-RUNS.md).
 */
export interface TimingModel {
  /** One host decision: read the panel, click, say something to the room. */
  hostActionMs: number;
  /** One match, from the pair sitting down to a winner being marked. */
  matchMs: number;
  /** An animated draw the room watches before anybody plays. */
  drawMs: number;
  /** Typing one participant's name in the naming phase. */
  namingMs: number;
}

export const DEFAULT_TIMING: TimingModel = {
  hostActionMs: 10_000,
  matchMs: 4 * 60_000,
  drawMs: 30_000,
  namingMs: 20_000,
};

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

export type DryRunAction =
  | 'TABLES_ADDED'
  | 'GROUPS_ADDED'
  | 'TOURNAMENT_STARTED'
  | 'ROUND_DRAWN'
  | 'MATCH_ASSIGNED'
  | 'MATCH_WINNER_SET'
  | 'ROUND_CLOSED'
  | 'PHASE_ADVANCED'
  | 'REPECHAGE_CANDIDATE_DRAWN'
  | 'REPECHAGE_ANSWERED'
  | 'REPECHAGE_FALLBACK'
  | 'GROUP_NAME_SET'
  | 'BRACKET_DRAWN'
  | 'BRACKET_MATCH_ASSIGNED'
  | 'BRACKET_WINNER_SET'
  | 'BRACKET_FINISHED';

/** How the host answers the `Hoffnungsrunde` (docs/TOURNAMENT-RULES.md §4). */
export interface RepechagePolicy {
  /** Whether the candidate just drawn takes the place — *Nachrücken? Ja/Nein*. */
  accepts(drawIndex: number, state: RepechageState): boolean;
  /**
   * Which answer the host gives the fallback dialog, counted from 1.
   *
   * `REOPEN_DECLINED` is only offered while somebody has declined, so a policy
   * that asks for it when nobody has is corrected to `BYES` rather than
   * deadlocking the run — the dialog leaves the host the same one answer.
   */
  fallback(attempt: number, state: RepechageState): RepechageFallback;
}

/** Everybody says yes, which is the ordinary evening. */
export const ACCEPT_ALL: RepechagePolicy = {
  accepts: () => true,
  fallback: () => 'BYES',
};

export interface DryRunSpec {
  /** What docs/QA-DRY-RUNS.md calls this run. */
  id: string;
  groups: number;
  tables: number;
  /** Seeds the tournament's own draws — every pairing is reproducible from it. */
  seed?: string;
  repechage?: RepechagePolicy;
  timing?: TimingModel;
}

// ---------------------------------------------------------------------------
// What a run reports
// ---------------------------------------------------------------------------

/** One host action, as it happened. */
export interface DryRunEvent {
  /** 1-based, in the order the host pressed them. */
  n: number;
  action: DryRunAction;
  /** The phase the tournament was in *after* the action committed. */
  phase: Phase;
  at: Timestamp;
  /** Milliseconds into the evening, by the timing model. */
  elapsedMs: number;
}

/**
 * The library the evening is being written to, as the app has one.
 *
 * A `Map` behind the same `PersistenceFiles` interface Rust implements, so the
 * bytes a check reads back are the bytes the autosave wrote — not a second
 * serialisation made for the occasion.
 */
export interface DryRunDisk {
  files: FakeFiles;
  deps: PersistenceDeps;
  /** Where in the fake library this tournament lives. */
  path: string;
}

/** The store as it stood between two actions, handed to `DryRunHooks`. */
export interface DryRunProbe {
  event: DryRunEvent;
  store: TournamentStore;
  clock: SimulatedClock;
  /** The file the autosave has just finished writing. */
  disk: DryRunDisk;
}

export interface DryRunHooks {
  /**
   * Called after every committed action, and awaited.
   *
   * This is where the per-scenario checks of issue #33 live: a kill and a
   * recovery, a beamer reopened, five presses of *Rückgängig*. Awaited because
   * the beamer channel is asynchronous, and a check that could not await it
   * would only ever be checking the host's own copy twice.
   */
  afterAction?(probe: DryRunProbe): void | Promise<void>;
}

/** What one round dealt, for the report. */
export interface DryRunRound {
  label: string;
  matches: number;
  /** Byes an odd count earned, plus any the §4 fallback owed. */
  byes: number;
  /** The deepest this round's queue got — §9 case 3. */
  queued: number;
}

export interface DryRunRepechage {
  target: number;
  drawn: number;
  accepted: number;
  declined: number;
  fallbackUsed: RepechageFallback | null;
  byes: number;
}

export interface DryRunReport {
  id: string;
  spec: DryRunSpec;
  timing: TimingModel;
  events: readonly DryRunEvent[];
  /** Every phase the tournament was in, in order — `SETUP` first. */
  phases: readonly Phase[];
  rounds: readonly DryRunRound[];
  /** Matches actually played, byes excluded — the bracket's included. */
  matchesPlayed: number;
  /** Byes the evening handed out (docs/TOURNAMENT-RULES.md §9 case 1). */
  byes: number;
  /** The deepest the queue ever got — §9 case 3. */
  peakQueue: number;
  /** Null when the repechage was skipped (§9 case 2). */
  repechage: DryRunRepechage | null;
  bracketSize: number;
  hasThirdPlaceMatch: boolean;
  standings: FinalStandings | null;
  /** Host decisions — the number of clicks an evening costs. */
  hostActions: number;
  /** The whole evening, by the timing model. */
  totalMs: number;
  /** The library the evening was autosaved to, for a check that reads it back. */
  disk: DryRunDisk;
}

/** An action the app refused that the scenario had every right to take. */
export class DryRunRefused extends Error {
  constructor(
    readonly action: DryRunAction,
    readonly phase: Phase,
    detail: string,
  ) {
    super(`${action} committed nothing in ${phase}: ${detail}`);
    this.name = 'DryRunRefused';
  }
}

/** The runner could not find a legal next move — a stuck tournament. */
export class DryRunStuck extends Error {
  constructor(
    readonly phase: Phase,
    detail: string,
  ) {
    super(`stuck in ${phase}: ${detail}`);
    this.name = 'DryRunStuck';
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Guards every loop in this file.
 *
 * Generous enough that no legitimate 40-group evening comes near it, low enough
 * that a rule which stopped terminating fails the suite in a second rather than
 * hanging CI.
 */
const MAX_STEPS = 5_000;

/**
 * The four actions that are allowed to change the phase.
 *
 * `startTournament` ends `SETUP` (issue #15); `drawBracket` and `finishBracket`
 * move the phase as half of one decision the host took by pressing one button
 * (docs/OPEN-QUESTIONS.md #54, #65); `advancePhase` is the phase machine itself.
 * Anything else moving it is a golden rule 3 violation, and `act` throws on one.
 */
const MOVES_PHASE = new Set<DryRunAction>([
  'PHASE_ADVANCED',
  'TOURNAMENT_STARTED',
  'BRACKET_DRAWN',
  'BRACKET_FINISHED',
]);

export async function runDryRun(spec: DryRunSpec, hooks: DryRunHooks = {}): Promise<DryRunReport> {
  const timing = spec.timing ?? DEFAULT_TIMING;
  const policy = spec.repechage ?? ACCEPT_ALL;
  const clock = simulatedClock();
  const store = createTournamentStore(undefined, { clock });

  /**
   * The harness's own randomness, and deliberately not the tournament's.
   *
   * Who wins a match is not a draw — it is the room playing — so it must not
   * come out of the seeded stream the pairings do. An RNG shared with the
   * tournament would move `rngCursor` behind the app's back and make every later
   * draw depend on results, which is the property golden rule 7 exists to keep.
   */
  const outcomes = createRng(`${spec.id}:outcomes`);

  const events: DryRunEvent[] = [];
  const phases: Phase[] = ['SETUP'];
  const rounds: DryRunRound[] = [];
  let peakQueue = 0;

  // The tournament is created through the persistence layer, not handed to the
  // store directly, because that is what the start screen does — and because it
  // is the only way the autosave below has a file to write to. Recovery is then
  // a real question about real bytes rather than a second serialisation made up
  // for the check (issue #9, issue #10).
  const files = fakeFiles();
  const deps = fakeDeps(files, {
    clock,
    newId: () => 'tnm_qa',
    newSeed: () => spec.seed ?? `qa-${spec.id}`,
  });
  const created = await createTournamentDocument(store, deps, { name: `QA ${spec.id}` });
  if (created.status !== 'created') {
    throw new DryRunStuck('SETUP', `the tournament was not written: ${created.kind}`);
  }
  const disk: DryRunDisk = { files, deps, path: created.path };

  /**
   * The debounced autosave, flushed after every action.
   *
   * `flush` rather than a timer, and after every action rather than at the end:
   * the check that follows is "the laptop dies *here*", and the only honest way
   * to ask it is against the file as the autosave had actually left it. What
   * this deliberately does not model is the debounce window itself — a crash
   * inside the 500 ms after a non-urgent commit costs that commit by design
   * (docs/FILE-FORMAT.md rule 4), and `@/store/autosave` is where that is
   * tested.
   */
  const autosave: Autosave = startAutosave(store, {
    save: () => autosaveTournament(store, deps),
    now: () => clock.elapsedMs(),
  });

  const read = () => {
    const document = store.getState().document;
    if (document === null) {
      throw new DryRunStuck('SETUP', 'no tournament is open');
    }
    return document;
  };

  /**
   * Presses one button and records what came of it.
   *
   * The revision check is the load-bearing line: every call site here is an
   * action the host window would have offered, so a commit that did not happen
   * is the app refusing something legal. Reporting that as a thrown error rather
   * than as a skipped step is what keeps a scenario from passing by not
   * happening.
   */
  const act = async (action: DryRunAction, press: () => void, detail = ''): Promise<void> => {
    const before = store.getState().revision;
    const phaseBefore = read().phase;
    press();
    if (store.getState().revision === before) {
      throw new DryRunRefused(action, phaseBefore, detail);
    }

    const phase = read().phase;
    // Golden rule 3, checked between every pair of actions rather than once at
    // the end: the only action that may move the phase is one the host took to
    // move it. Anything else advancing the evening is the failure this whole
    // harness is pointed at.
    if (phase !== phaseBefore && !MOVES_PHASE.has(action)) {
      throw new DryRunStuck(phase, `${action} moved the phase from ${phaseBefore} on its own`);
    }
    if (phase !== phases[phases.length - 1]) {
      phases.push(phase);
    }

    clock.advance(action === 'GROUP_NAME_SET' ? 0 : timing.hostActionMs);
    await autosave.flush();
    const event: DryRunEvent = {
      n: events.length + 1,
      action,
      phase,
      at: clock.now(),
      elapsedMs: clock.elapsedMs(),
    };
    events.push(event);
    await hooks.afterAction?.({ event, store, clock, disk });
  };

  // -- Setup ---------------------------------------------------------------

  await act('TABLES_ADDED', () => addTables(store, spec.tables), `${spec.tables} tables`);
  await act('GROUPS_ADDED', () => addGroups(store, spec.groups), `${spec.groups} groups`);
  await act('TOURNAMENT_STARTED', () => startTournament(store), 'pre-start checks');

  // -- Rounds --------------------------------------------------------------

  /** Fills every free table from the queue, one host confirmation each. */
  const fillTables = async (): Promise<void> => {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const document = read();
      const table = freeTables(document)[0];
      if (table === undefined || nextQueuedMatch(document) === null) {
        return;
      }
      await act(
        'MATCH_ASSIGNED',
        () => startNextMatch(store, table.id, clock),
        `table ${table.label}`,
      );
    }
    throw new DryRunStuck(read().phase, 'the table queue would not drain');
  };

  const fillBracketTables = async (): Promise<void> => {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const document = read();
      const table = freeTables(document)[0];
      if (table === undefined || nextQueuedBracketNode(document) === null) {
        return;
      }
      await act(
        'BRACKET_MATCH_ASSIGNED',
        () => startNextBracketMatch(store, table.id, clock),
        `table ${table.label}`,
      );
    }
    throw new DryRunStuck(read().phase, 'the bracket queue would not drain');
  };

  /**
   * Plays the open round to its last result, in waves.
   *
   * A wave is what a room actually does: every free table is filled, the matches
   * on them are played at the same time, and the results come in together.
   * Modelling it that way rather than one match at a time is what makes the queue
   * depth and the elapsed time mean anything — thirteen matches on three tables
   * are five waves, not thirteen.
   */
  const playRound = async (): Promise<void> => {
    const opened = currentRound(read());
    if (opened === null) {
      throw new DryRunStuck(read().phase, 'no round is open');
    }
    const byes = opened.matches.filter((match) => match.b === null).length;
    // Measured at the draw and not again, because that is when it is deepest:
    // the queue only ever drains from here. It could grow if a table were taken
    // out of service with a match on it and the host requeued it (issue #13),
    // and a scenario that does that will have to measure this per wave.
    const queued = queuedMatches(opened).length;
    peakQueue = Math.max(peakQueue, queued);

    for (let wave = 0; wave < MAX_STEPS; wave += 1) {
      await fillTables();

      const round = currentRound(read());
      if (round === null || undecidedMatches(round).length === 0) {
        rounds.push({ label: opened.label, matches: opened.matches.length, byes, queued });
        return;
      }

      const running = round.matches.filter(
        (match) => match.tableId !== null && match.winnerId === null,
      );
      if (running.length === 0) {
        throw new DryRunStuck(read().phase, 'matches are waiting but no table is playing');
      }

      // The wave is played. One `matchMs` for all of them, because they are on
      // different tables at the same time.
      clock.advance(timing.matchMs);
      for (const match of running) {
        await act(
          'MATCH_WINNER_SET',
          () => setMatchWinner(store, match.id, winnerOf(match, outcomes)),
          `match ${match.id}`,
        );
      }
    }
    throw new DryRunStuck(read().phase, 'the round would not finish');
  };

  const runRound = async (): Promise<void> => {
    clock.advance(timing.drawMs);
    await act('ROUND_DRAWN', () => drawRound(store, clock), 'draw blockers');
    await playRound();
    await act('ROUND_CLOSED', () => closeRound(store), 'close blockers');
  };

  // §9 case 5: two participants play one match and that match is the `Finale`,
  // so there is no qualifying round to draw at all.
  if (canDrawRound(read())) {
    await runRound();
  }
  await act('PHASE_ADVANCED', () => advancePhase(store), 'qualifying to next');

  // -- Repechage -----------------------------------------------------------

  let repechage: DryRunRepechage | null = null;

  if (read().phase === 'REPECHAGE') {
    let drawn = 0;
    let fallbacks = 0;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const state = repechageState(read());
      if (state === null) {
        throw new DryRunStuck('REPECHAGE', 'the phase has no pot');
      }

      if (state.pending !== null) {
        const accepted = policy.accepts(drawn, state);
        await act(
          'REPECHAGE_ANSWERED',
          () => (accepted ? acceptRepechageCandidate(store) : declineRepechageCandidate(store)),
          accepted ? 'accept' : 'decline',
        );
        continue;
      }

      if (state.complete) {
        break;
      }

      if (state.fallbackNeeded) {
        fallbacks += 1;
        const asked = policy.fallback(fallbacks, state);
        // The dialog only offers *Ausgeschiedene erneut zulassen* while somebody
        // has declined; taking the other answer here is what the host would be
        // left with, not a deadlock.
        const choice: RepechageFallback =
          asked === 'REOPEN_DECLINED' && state.declined.length === 0 ? 'BYES' : asked;
        await act(
          'REPECHAGE_FALLBACK',
          () => useRepechageFallback(store, choice),
          `fallback ${choice}`,
        );
        continue;
      }

      drawn += 1;
      await act(
        'REPECHAGE_CANDIDATE_DRAWN',
        () => drawRepechageCandidate(store),
        `candidate ${drawn}`,
      );
    }

    const settled = repechageState(read());
    if (settled === null || !settled.complete) {
      throw new DryRunStuck('REPECHAGE', 'the pot never filled the field');
    }
    const draws = read().repechage?.draws ?? [];
    repechage = {
      target: settled.target,
      drawn: draws.length,
      accepted: draws.filter((draw) => draw.accepted === true).length,
      declined: draws.filter((draw) => draw.accepted === false).length,
      fallbackUsed: settled.fallbackUsed,
      byes: settled.byes,
    };

    await act('PHASE_ADVANCED', () => advancePhase(store), 'repechage to next');
  }

  // -- Elimination ---------------------------------------------------------

  for (let step = 0; step < MAX_STEPS && read().phase === 'ELIMINATION'; step += 1) {
    await runRound();
    if (canAdvancePhase(read())) {
      await act('PHASE_ADVANCED', () => advancePhase(store), 'elimination to next');
    } else if (!canDrawRound(read())) {
      throw new DryRunStuck('ELIMINATION', 'neither another round nor the next phase');
    }
  }

  // -- Naming --------------------------------------------------------------

  if (read().phase !== 'NAMING') {
    throw new DryRunStuck(read().phase, 'the evening never reached the naming phase');
  }

  for (const group of [...activeGroups(read())].sort((a, b) => a.number - b.number)) {
    clock.advance(timing.namingMs);
    await act(
      'GROUP_NAME_SET',
      () => setGroupName(store, group.id, `Team ${group.number}`),
      `group ${group.number}`,
    );
  }

  // -- Bracket -------------------------------------------------------------

  clock.advance(timing.drawMs);
  await act('BRACKET_DRAWN', () => drawBracket(store, clock), 'bracket blockers');

  for (let wave = 0; wave < MAX_STEPS; wave += 1) {
    await fillBracketTables();

    const document = read();
    if (isBracketComplete(document)) {
      break;
    }

    const running = (document.bracket?.nodes ?? []).filter(
      (node) => node.tableId !== null && node.winnerId === null,
    );
    if (running.length === 0) {
      throw new DryRunStuck('BRACKET', 'bracket matches are waiting but no table is playing');
    }

    clock.advance(timing.matchMs);
    for (const node of running) {
      await act(
        'BRACKET_WINNER_SET',
        () => setBracketWinner(store, node.id, bracketWinnerOf(node, outcomes)),
        `node ${node.id}`,
      );
    }
  }

  await act('BRACKET_FINISHED', () => finishBracket(store), 'finish blockers');
  autosave.stop();

  // -- The report ----------------------------------------------------------

  const document = read();
  const roundMatches = document.rounds.flatMap((round) => round.matches);
  const bracketNodes = document.bracket?.nodes ?? [];
  const playedNodes = bracketNodes.filter((node) => node.slotA !== null && node.slotB !== null);
  const byeNodes = bracketNodes.filter((node) => node.winnerId !== null && node.slotB === null);

  return {
    id: spec.id,
    spec,
    timing,
    events,
    phases,
    rounds,
    matchesPlayed: roundMatches.filter((match) => match.b !== null).length + playedNodes.length,
    byes: roundMatches.filter((match) => match.b === null).length + byeNodes.length,
    peakQueue,
    repechage,
    bracketSize: document.bracket?.size ?? 0,
    hasThirdPlaceMatch: (document.bracket?.thirdPlaceNodeId ?? null) !== null,
    standings: finalStandings(document),
    hostActions: events.length,
    totalMs: clock.elapsedMs(),
    disk,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function winnerOf(match: Match, rng: Rng): GroupId {
  const b = match.b;
  if (b === null) {
    return match.a;
  }
  return rng.int(2) === 0 ? match.a : b;
}

function bracketWinnerOf(node: BracketNode, rng: Rng): GroupId {
  const { slotA, slotB } = node;
  if (slotA === null || slotB === null) {
    throw new DryRunStuck('BRACKET', `node ${node.id} has an empty slot`);
  }
  return rng.int(2) === 0 ? slotA : slotB;
}
