import { snapshotSchema, type Snapshot } from '@/domain/snapshot';
import type { BeamerStore } from '@/store/beamerStore';
import { reportProblem } from '@/store/problems';
import {
  beamerProblemSchema,
  requestSnapshotSchema,
  sceneMessageSchema,
  BEAMER_PROBLEM_EVENT,
  REQUEST_SNAPSHOT_EVENT,
  SCENE_EVENT,
  SNAPSHOT_EVENT,
  type SyncTransport,
  type Unsubscribe,
} from '@/store/syncContract';
import { toSnapshot, type TournamentStore } from '@/store/tournamentStore';

/**
 * The one-way channel that makes "the beamer is a pure view" true
 * (docs/ARCHITECTURE.md §3).
 *
 * Both halves are started once per window and never called from an action. An
 * action's only job is to commit; reaching the beamer is this layer's job.
 */

function reportSyncFailure(error: unknown): void {
  // Never throws onward: a failed broadcast must not take down the host window
  // mid-event. It is not swallowed either — a projector that stopped being
  // sent pictures looks exactly like one that is up to date (issue #30).
  reportProblem('beamerSync', 'beamer.sync-failed', error);
}

export interface HostSync {
  /** Sends the current picture unprompted — used when the beamer reopens. */
  broadcast(delivery?: Snapshot['delivery']): void;
  stop(): Promise<void>;
}

/**
 * Starts the host half: broadcast on every commit, answer catch-up requests.
 *
 * The broadcast is wired here, centrally, rather than at each action site. An
 * action added by a later issue is therefore synced by construction — there is
 * no call for its author to forget (issue #5 tasks).
 */
export async function startHostSync(
  store: TournamentStore,
  transport: SyncTransport,
): Promise<HostSync> {
  const send = (event: string, payload: unknown) => {
    transport.emit(event, payload).catch(reportSyncFailure);
  };

  /**
   * The picture the projector is holding while the host works ahead, or null
   * when nothing is being held (issue #28).
   *
   * Captured at the commit that froze, because that state *is* what the beamer
   * is showing — everything before it was broadcast. Holding it here rather
   * than teaching the beamer about freezing keeps golden rule 4 intact: the
   * beamer still renders whatever it was last told, and a beamer reopened
   * mid-freeze is answered with the held picture rather than with the work in
   * progress the room is not supposed to see yet.
   */
  let held: Snapshot | null = null;

  const broadcast = (delivery: Snapshot['delivery'] = 'live') => {
    const state = store.getState();
    if (state.frozen) {
      // A beamer that reopens mid-freeze is answered with the held picture,
      // never with the work in progress. Capturing here as well as on commit
      // covers the case where nothing has been committed since the freeze.
      held ??= toSnapshot(state, 'catchUp');
      send(SNAPSHOT_EVENT, held);
      return;
    }
    send(SNAPSHOT_EVENT, toSnapshot(state, delivery));
  };

  // Commits that left the tournament alone go out on the light channel, so a
  // blackout is not queued behind sixty-four groups. The decision comes from
  // what the mutator returned, not from comparing states: a comparison would be
  // reference equality, and an action that mutated the tournament in place
  // would look unchanged and lose its data silently.
  const unsubscribeStore = store.onCommit((next, meta) => {
    // Frozen: nothing at all leaves the host. Not the scene, not the result the
    // host has just marked, not the round they are drawing ahead — the room
    // keeps the picture it was on when the host reached for the button
    // (issue #28, golden rule 3).
    if (next.frozen) {
      held ??= toSnapshot(next, 'catchUp');
      return;
    }

    // An undo travels as a catch-up: the beamer follows it like any other
    // state change, but renders it settled rather than animating into it.
    // Replaying the pairing reveal because the host corrected a misclick would
    // show the audience a draw that is not happening (issue #11).
    //
    // The thaw travels the same way and for the same reason: everything that
    // happened behind the freeze arrives at once, and the room must be shown
    // where the evening got to, not watch it played out in fast-forward.
    const thawed = held !== null;
    held = null;
    const delivery: Snapshot['delivery'] = meta.settled || thawed ? 'catchUp' : 'live';

    // A thaw always goes out whole. What changed behind the freeze is unknown
    // to this listener — it saw one commit, and there may have been fifty — so
    // the light channel could leave the projector holding a tournament from
    // before the freeze.
    if (meta.touchedTournament || thawed) {
      send(SNAPSHOT_EVENT, toSnapshot(next, delivery));
      return;
    }
    send(SCENE_EVENT, {
      revision: next.revision,
      scene: next.scene,
      autoFollow: next.autoFollow,
      skipToken: next.skipToken,
      delivery,
    });
  });

  // A beamer that just mounted has no idea what is going on. Its answer is
  // flagged `catchUp` so it renders the scene settled rather than animating
  // into a draw that finished ten minutes ago.
  const unlistenRequest = await transport.listen(
    REQUEST_SNAPSHOT_EVENT,
    requestSnapshotSchema,
    () => broadcast('catchUp'),
  );

  /*
    The projector saying it could not draw what it was staged (issue #30).
    Nothing about the tournament changes — this only reaches the host's toast
    strip, because the host is the one who can stage something else, and with
    the projector behind them they have no other way of finding out.
  */
  const unlistenProblem = await transport.listen(
    BEAMER_PROBLEM_EVENT,
    beamerProblemSchema,
    ({ scene, detail }) => {
      reportProblem('beamerScene', 'beamer.scene-failed-remote', `${scene}: ${detail}`);
    },
  );

  return {
    broadcast,
    stop: async () => {
      unsubscribeStore();
      unlistenRequest();
      unlistenProblem();
    },
  };
}

export interface BeamerSync {
  stop(): Promise<void>;
}

/**
 * How long the beamer waits for an answer before asking again, and how often.
 *
 * The request is fire-and-forget, and at startup both windows come up at once:
 * Rust opens the beamer during setup, so the beamer can ask before the host has
 * registered its listener. Without a retry that beamer sits on the idle screen
 * until the host happens to commit something — which, at the start of an event,
 * may be minutes.
 */
const REQUEST_RETRY_MS = 250;
const REQUEST_ATTEMPTS = 8;

/**
 * Starts the beamer half: subscribe, then ask for the current picture.
 *
 * Subscribing first is not a detail. Asking first leaves a window in which the
 * host's answer arrives before anything is listening, and the beamer sits on
 * the idle screen for the rest of the event.
 */
export async function startBeamerSync(
  store: BeamerStore,
  transport: SyncTransport,
): Promise<BeamerSync> {
  const unlisteners: Unsubscribe[] = [];

  unlisteners.push(
    await transport.listen(SNAPSHOT_EVENT, snapshotSchema, (snapshot) => {
      store.applySnapshot(snapshot);
    }),
  );

  // A scene message carries no tournament data, so it is merged onto whatever
  // the beamer already holds rather than replacing it.
  unlisteners.push(
    await transport.listen(
      SCENE_EVENT,
      sceneMessageSchema,
      ({ revision, scene, autoFollow, skipToken, delivery }) => {
        const current = store.getState().snapshot;
        store.applySnapshot({ ...current, revision, scene, autoFollow, skipToken, delivery });
      },
    ),
  );

  // Stops as soon as anything arrives: the host answers a catch-up with the
  // current revision, so a delivered snapshot is the acknowledgement.
  let answered = store.getState().snapshot.revision > 0;
  const unsubscribeAnswer = store.subscribe(() => {
    answered = true;
  });

  let attempts = 0;
  const ask = () => {
    transport.emit(REQUEST_SNAPSHOT_EVENT, {}).catch(reportSyncFailure);
  };
  ask();

  const retry = setInterval(() => {
    attempts += 1;
    if (answered || attempts >= REQUEST_ATTEMPTS) {
      clearInterval(retry);
      return;
    }
    ask();
  }, REQUEST_RETRY_MS);

  return {
    stop: async () => {
      clearInterval(retry);
      unsubscribeAnswer();
      for (const unlisten of unlisteners) {
        unlisten();
      }
    },
  };
}
