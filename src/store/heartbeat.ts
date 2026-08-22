import {
  heartbeatSchema,
  HEARTBEAT_EVENT,
  type SyncTransport,
  type Unsubscribe,
} from '@/store/syncContract';

/**
 * Liveness for the beamer window (issue #5 tasks).
 *
 * "Is the beamer open?" is answered by Rust in `beamer:status` — that is about
 * the *window*. This answers a different question: is the WebView inside it
 * still running and still listening? A window that is open but whose renderer
 * has died shows the audience a frozen picture and reports itself as perfectly
 * fine, which is the failure the host most needs to be told about.
 */

/** Beats are cheap; a stale picture during an event is not. */
export const HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Three missed beats before the host is told the beamer is gone.
 *
 * One missed beat is a busy WebView mid-animation, and a liveness light that
 * flickers every time the draw animates is a light the host learns to ignore.
 */
export const HEARTBEAT_TIMEOUT_MS = 3 * HEARTBEAT_INTERVAL_MS;

/**
 * Whether a beamer that last beat at `lastBeatAt` still counts as alive.
 *
 * Takes `now` rather than reading the clock, so the host's liveness light is
 * testable without waiting in real time (docs/ARCHITECTURE.md §5).
 */
export function isBeamerAlive(
  lastBeatAt: number | null,
  now: number,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (lastBeatAt === null) {
    return false;
  }
  return now - lastBeatAt < timeoutMs;
}

/**
 * Beamer side: beat until the window goes away.
 *
 * The first beat is sent immediately. Waiting a full interval would leave the
 * host's panel claiming the beamer is dead for a second after it demonstrably
 * came back.
 */
export function startHeartbeat(
  transport: SyncTransport,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): Unsubscribe {
  let beat = 0;

  const send = () => {
    transport.emit(HEARTBEAT_EVENT, { beat: beat++ }).catch((error: unknown) => {
      console.error('beamer heartbeat failed', error);
    });
  };

  send();
  const timer = setInterval(send, intervalMs);

  return () => {
    clearInterval(timer);
  };
}

/** Host side: record when the beamer last proved it was alive. */
export async function watchHeartbeat(
  transport: SyncTransport,
  now: () => number,
  onBeat: (lastBeatAt: number) => void,
): Promise<Unsubscribe> {
  return transport.listen(HEARTBEAT_EVENT, heartbeatSchema, () => {
    onBeat(now());
  });
}
