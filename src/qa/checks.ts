import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Match, Table, Tournament } from '@/domain/types';
import type { DryRunDisk } from '@/qa/dryRun';
import { createBeamerStore, type BeamerViewState } from '@/store/beamerStore';
import { openTournamentAt } from '@/store/persistence';
import { startBeamerSync, startHostSync } from '@/store/sync';
import { createLinkedTransports } from '@/store/testTransport';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

/**
 * The checks issue #33 asks for at every point of every scenario, written once.
 *
 * Each one models a thing that actually goes wrong at an event — the laptop
 * dies, the projector cable is kicked out, the host misclicks — and each one
 * goes through the layer that would really have to cope with it rather than
 * inspecting the store and declaring itself satisfied. What is left over, the
 * part that needs a projector and a pair of eyes at ten metres, is listed in
 * docs/QA-DRY-RUNS.md.
 */

/** What a restarted app came back with. */
export interface RecoveredApp {
  document: Tournament;
  /** The projection the beamer would be sent, rebuilt from the file. */
  snapshot: TournamentSnapshot;
}

/**
 * Kills the app and starts it again on the file the autosave left behind.
 *
 * Nothing is serialised here: the bytes read back are the ones
 * `autosaveTournament` actually wrote during the run, and they make the whole
 * return journey through `openTournamentAt` — schema version, Zod,
 * `fromTournamentFile` and all. A check that re-serialised the tournament for
 * the occasion would prove nothing about the one place a mid-event crash is
 * really decided, which is whether the file on disk can be read at all
 * (docs/FILE-FORMAT.md rule 1).
 */
export async function restartFromDisk(disk: DryRunDisk): Promise<RecoveredApp> {
  if (!disk.files.disk.has(disk.path)) {
    throw new Error(`the autosave never wrote ${disk.path}`);
  }

  const restarted = createTournamentStore();
  const outcome = await openTournamentAt(restarted, disk.deps, disk.path);
  if (outcome.status !== 'opened') {
    throw new Error(
      `the recovered file did not open: ${outcome.status === 'failed' ? outcome.reason : outcome.status}`,
    );
  }

  const recovered = restarted.getState();
  if (recovered.document === null) {
    throw new Error('the file opened but no tournament came back');
  }
  return { document: recovered.document, snapshot: recovered.tournament };
}

/**
 * Closes the beamer window and opens it again, over the real sync channel.
 *
 * The transports round-trip their payloads through JSON and re-parse them with
 * the shipping schemas, so this exercises what actually crosses the window
 * boundary — golden rule 4's promise is that the reopened window is handed the
 * settled current picture, and the only way to check it is to reopen one.
 */
export async function reopenBeamer(store: TournamentStore): Promise<BeamerViewState> {
  const transports = createLinkedTransports();
  const host = await startHostSync(store, transports.host);
  const beamer = createBeamerStore();
  const sync = await startBeamerSync(beamer, transports.beamer);

  const view = beamer.getState();
  await sync.stop();
  await host.stop();
  return view;
}

/**
 * Presses *Rückgängig* `steps` times and then puts it all back.
 *
 * Both halves, because the round trip is what makes the check safe to run in
 * the middle of a scenario that has to keep going afterwards — and because a
 * redo that does not restore exactly what the undo took away is the same bug
 * from the other side.
 */
export interface UndoRoundTrip {
  /** The tournament after the undos — compare with where the host was. */
  afterUndo: Tournament;
  /** The tournament after the redos — compare with where the host is. */
  afterRedo: Tournament;
  /** How many steps were actually taken; fewer near the bottom of the stack. */
  steps: number;
}

export function undoRedo(store: TournamentStore, steps: number): UndoRoundTrip {
  let taken = 0;
  while (taken < steps && store.undo()) {
    taken += 1;
  }
  const afterUndo = documentOf(store, 'after undo');

  for (let step = 0; step < taken; step += 1) {
    if (!store.redo()) {
      throw new Error(`redo refused step ${step + 1} of ${taken}`);
    }
  }
  return { afterUndo, afterRedo: documentOf(store, 'after redo'), steps: taken };
}

/**
 * Everything an undo is answerable for.
 *
 * `log`, `rngCursor` and `updatedAt` are dropped, and not as a convenience: the
 * undo stack deliberately leaves all three moving forward (`@/store/undo`). The
 * audit trail records that the host took a step back, the RNG cursor never
 * rewinds so a redrawn round cannot repeat pairings the room has seen, and the
 * file's clock keeps ticking. Comparing them would be asserting the opposite of
 * what the design says.
 */
export function undoableShape(
  document: Tournament,
): Omit<Tournament, 'log' | 'rngCursor' | 'updatedAt'> {
  const { log: _log, rngCursor: _rngCursor, updatedAt: _updatedAt, ...shape } = document;
  return shape;
}

/** The three fields `tableSchema` ties together, for a failure worth reading. */
export function occupancy(
  document: Tournament,
): readonly Pick<Table, 'id' | 'status' | 'currentMatchId' | 'occupiedSince'>[] {
  return document.tables.map(({ id, status, currentMatchId, occupiedSince }) => ({
    id,
    status,
    currentMatchId,
    occupiedSince,
  }));
}

/** Every result the host has marked, which is what a crash must not cost. */
export function decidedResults(
  document: Tournament,
): readonly (Pick<Match, 'id' | 'winnerId' | 'status' | 'tableId'> & { round: string })[] {
  return document.rounds.flatMap((round) =>
    round.matches
      .filter((match) => match.winnerId !== null)
      .map(({ id, winnerId, status, tableId }) => ({
        round: round.id,
        id,
        winnerId,
        status,
        tableId,
      })),
  );
}

function documentOf(store: TournamentStore, when: string): Tournament {
  const document = store.getState().document;
  if (document === null) {
    throw new Error(`no tournament ${when}`);
  }
  return document;
}
