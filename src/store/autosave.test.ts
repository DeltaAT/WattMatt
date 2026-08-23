import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import {
  AUTOSAVE_DEBOUNCE_MS,
  startAutosave,
  type Autosave,
  type AutosaveState,
} from '@/store/autosave';
import type { AutosaveOutcome } from '@/store/persistence';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

/**
 * The debounce, the forced saves and the failure state (issue #10).
 *
 * The write itself is `autosaveTournament`, tested in `persistence.test.ts`
 * against a fake disk. What is only reachable here is the timing, which is the
 * part a live event depends on: a write that never fires costs the host a
 * round, and one that fires on every keystroke costs them the machine.
 *
 * The store, the actions and the commit funnel are the real ones. Only the
 * write and the clock are doubles.
 */

const PATH = 'C:\\turniere\\Sommer.wattmatt';

interface Harness {
  store: TournamentStore;
  autosave: Autosave;
  /** Every attempt that actually reached the disk. */
  saves: number;
  states: AutosaveState[];
  /** Simulates a host decision: the tournament moves on. */
  change(): void;
  /** The same, but a moment the host must not lose (round close, phase change). */
  changeUrgently(): void;
  outcome: AutosaveOutcome;
  now: number;
}

function harness(options: { open?: boolean } = {}): Harness {
  const store = createTournamentStore();
  const document: Tournament = tournament();

  if (options.open !== false) {
    store.commit(() => ({ document, file: { status: 'saved', path: PATH } }));
  }

  const state: Harness = {
    store,
    saves: 0,
    states: [],
    outcome: { status: 'saved', path: PATH },
    now: 1_000,
    change: () => store.commit(() => ({ document })),
    changeUrgently: () => store.commit(() => ({ document }), { urgent: true }),
    autosave: null as unknown as Autosave,
  };

  state.autosave = startAutosave(store, {
    save: async () => {
      state.saves += 1;
      if (state.outcome.status === 'saved') {
        // The real write marks the file clean; without that the store would
        // stay dirty and every test here would see an endless save loop.
        store.commit((current) => ({
          file: {
            status: 'saved',
            path: current.file.status === 'unsaved' ? PATH : current.file.path,
          },
        }));
      }
      return state.outcome;
    },
    now: () => state.now,
  });
  state.autosave.subscribe((next) => state.states.push(next));

  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the autosave debounce', () => {
  it('waits for the host to stop before it touches the disk', async () => {
    const saver = harness();

    saver.change();

    expect(saver.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(saver.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saver.saves).toBe(1);
  });

  /**
   * Entering a round's results is a burst of clicks. One write at the end of it
   * is the point of the debounce — ten writes, each rotating three backups,
   * would throw away the recovery depth the backups exist to provide.
   */
  it('collapses a burst of host decisions into one write', async () => {
    const saver = harness();

    for (let click = 0; click < 8; click += 1) {
      saver.change();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saver.saves).toBe(1);
  });

  it('reports that a write is coming, so the host is never told it is saved when it is not', () => {
    const saver = harness();

    saver.change();

    expect(saver.autosave.getState().activity).toBe('pending');
  });

  it('leaves a tournament that is already on disk alone', async () => {
    const saver = harness();

    // Commits that touch nothing but the scene still go through `commit`.
    saver.store.commit(() => ({ autoFollow: false }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(saver.saves).toBe(0);
  });

  /**
   * The first write of a new tournament can fail — a read-only library, a stick
   * that is not there. The tournament then has no path, and an autosave that
   * "helpfully" opened a save dialog half a second later would take the machine
   * away from a host who is mid-sentence (CLAUDE.md golden rule 3).
   */
  it('never writes a tournament that has no file, and never opens a dialog for one', async () => {
    const saver = harness({ open: false });
    saver.store.commit(() => ({ document: tournament(), file: { status: 'unsaved' } }));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(saver.saves).toBe(0);
  });

  it('stops waiting when a manual save got there first', async () => {
    const saver = harness();
    saver.change();

    // "Turnier speichern" while the debounce is still counting.
    saver.store.commit(() => ({ file: { status: 'saved', path: PATH } }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(saver.saves).toBe(0);
    expect(saver.autosave.getState().activity).toBe('idle');
  });

  it('writes nothing at all once it has been stopped', async () => {
    const saver = harness();
    saver.change();

    saver.autosave.stop();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(saver.saves).toBe(0);
  });
});

describe('forced saves', () => {
  /**
   * docs/FILE-FORMAT.md rule 4: round close and phase change do not wait. The
   * actions that will ask for this arrive with the round and phase issues; the
   * flag they set is here so they inherit it rather than each remembering to
   * call a save.
   */
  it('skips the debounce entirely for an urgent commit', async () => {
    const saver = harness();

    saver.changeUrgently();
    await vi.advanceTimersByTimeAsync(0);

    expect(saver.saves).toBe(1);
  });

  it('drops a debounce that an urgent commit overtook, rather than writing twice', async () => {
    const saver = harness();

    saver.change();
    saver.changeUrgently();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(saver.saves).toBe(1);
  });

  it('writes what is waiting when it is flushed, and waits for it to land', async () => {
    const saver = harness();
    saver.change();

    await saver.autosave.flush();

    expect(saver.saves).toBe(1);
    expect(saver.autosave.getState().activity).toBe('idle');
  });

  it('flushes to nothing when there is nothing outstanding', async () => {
    const saver = harness();

    await saver.autosave.flush();

    expect(saver.saves).toBe(0);
  });
});

describe('what the host is shown', () => {
  it('records when the tournament actually reached the disk', async () => {
    const saver = harness();
    saver.now = 1_700_000_000_000;

    saver.change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saver.autosave.getState()).toEqual({
      activity: 'idle',
      lastSavedAt: 1_700_000_000_000,
      failure: null,
    });
  });

  /**
   * The issue's "autosave failures surface as a persistent warning, not a
   * silent no-op". The state carries the failure until a write succeeds; the
   * host window renders it as a banner it cannot be dismissed away from.
   */
  it('keeps reporting a failure until a write succeeds', async () => {
    const saver = harness();
    saver.outcome = { status: 'failed', path: PATH, kind: 'notFound' };

    saver.change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saver.autosave.getState().failure).toBe('notFound');

    // The stick is back in. The store is still dirty, so the next commit
    // schedules another attempt.
    saver.outcome = { status: 'saved', path: PATH };
    saver.change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saver.autosave.getState().failure).toBeNull();
  });

  it('never reports a save for a write that never happened', async () => {
    const saver = harness();
    saver.outcome = { status: 'skipped' };

    saver.change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saver.autosave.getState().lastSavedAt).toBeNull();
  });

  it('treats a write that threw as a failure rather than losing it', async () => {
    const store = createTournamentStore();
    const document = tournament();
    store.commit(() => ({ document, file: { status: 'saved', path: PATH } }));
    const autosave = startAutosave(store, {
      save: () => Promise.reject(new Error('the layer below broke')),
      now: () => 0,
    });

    store.commit(() => ({ document }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(autosave.getState().failure).toBe('io');
    autosave.stop();
  });

  it('publishes every change to its subscribers', async () => {
    const saver = harness();

    saver.change();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saver.states.map((state) => state.activity)).toEqual(['pending', 'saving', 'idle']);
  });
});

describe('overlapping writes', () => {
  /**
   * A commit that lands while a write is in flight must not race it onto the
   * same path: the loser is whichever finishes second, which — when the first
   * carried the newer tournament — is the older one overwriting it.
   */
  it('never has two writes on the same file at once', async () => {
    const store = createTournamentStore();
    const document = tournament();
    store.commit(() => ({ document, file: { status: 'saved', path: PATH } }));

    let inFlight = 0;
    let peak = 0;
    const waiting: Array<() => void> = [];

    const autosave = startAutosave(store, {
      save: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
        inFlight -= 1;
        store.commit(() => ({ file: { status: 'saved', path: PATH } }));
        return { status: 'saved', path: PATH };
      },
      now: () => 0,
    });

    store.commit(() => ({ document }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    // The host keeps working while the first write is still open.
    store.commit(() => ({ document }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    waiting.shift()?.();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    waiting.shift()?.();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(peak).toBe(1);
    autosave.stop();
  });
});
