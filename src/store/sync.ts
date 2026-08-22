import { snapshotSchema, type Snapshot } from '@/domain/snapshot';
import type { BeamerStore } from '@/store/beamerStore';
import {
  requestSnapshotSchema,
  sceneMessageSchema,
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
  // mid-event. Proper surfacing lands with issue #30.
  console.error('beamer sync failed', error);
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

  const broadcast = (delivery: Snapshot['delivery'] = 'live') => {
    send(SNAPSHOT_EVENT, toSnapshot(store.getState(), delivery));
  };

  // Commits that left the tournament alone go out on the light channel, so a
  // blackout is not queued behind sixty-four groups. The decision comes from
  // what the mutator returned, not from comparing states: a comparison would be
  // reference equality, and an action that mutated the tournament in place
  // would look unchanged and lose its data silently.
  const unsubscribeStore = store.onCommit((next, meta) => {
    if (meta.touchedTournament) {
      send(SNAPSHOT_EVENT, toSnapshot(next, 'live'));
      return;
    }
    send(SCENE_EVENT, {
      revision: next.revision,
      scene: next.scene,
      autoFollow: next.autoFollow,
      delivery: 'live',
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

  return {
    broadcast,
    stop: async () => {
      unsubscribeStore();
      unlistenRequest();
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
      ({ revision, scene, autoFollow, delivery }) => {
        const current = store.getState().snapshot;
        store.applySnapshot({ ...current, revision, scene, autoFollow, delivery });
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
