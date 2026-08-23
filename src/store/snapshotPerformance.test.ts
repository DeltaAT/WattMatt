import { describe, expect, it } from 'vitest';

import { groupIdSchema } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { showScene } from '@/store/actions/scene';
import { createBeamerStore } from '@/store/beamerStore';
import { startBeamerSync, startHostSync } from '@/store/sync';
import { createLinkedTransports } from '@/store/testTransport';
import { createTournamentStore } from '@/store/tournamentStore';

/**
 * Issue #5 acceptance criterion: a 64-group snapshot round-trips in under
 * 16 ms — one frame at 60 Hz. Anything slower is visible as a stutter on the
 * projector at the moment the host commits something.
 *
 * The measured path is the real one: commit → serialise → Zod-parse → applied
 * in the beamer store. The median is asserted rather than the worst run, since
 * a shared CI runner can stall any single iteration for reasons that have
 * nothing to do with this code.
 */

const BUDGET_MS = 16;
const RUNS = 25;

function sixtyFourGroups(): TournamentSnapshot {
  return {
    groups: Array.from({ length: 64 }, (_, index) => ({
      id: groupIdSchema.parse(`group-${index + 1}`),
      number: index + 1,
      name: `Mannschaft ${index + 1}`,
      status: 'ACTIVE' as const,
    })),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('snapshot round-trip performance', () => {
  it('delivers a 64-group tournament to the beamer inside one frame', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    const beamer = createBeamerStore();
    await startHostSync(host, transports.host);
    await startBeamerSync(beamer, transports.beamer);

    const tournament = sixtyFourGroups();
    const durations: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      // A fresh object each run: an identical reference would take the light
      // channel and measure the wrong thing entirely.
      const payload: TournamentSnapshot = { groups: [...tournament.groups] };

      const started = performance.now();
      host.commit(() => ({ tournament: payload }));
      durations.push(performance.now() - started);

      expect(beamer.getState().snapshot.tournament.groups).toHaveLength(64);
    }

    const observed = median(durations);
    expect(observed, `median round-trip was ${observed.toFixed(2)} ms`).toBeLessThan(BUDGET_MS);
  });

  it('keeps a blackout inside the budget while 64 groups are loaded', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    const beamer = createBeamerStore();
    await startHostSync(host, transports.host);
    await startBeamerSync(beamer, transports.beamer);

    host.commit(() => ({ tournament: sixtyFourGroups() }));

    const durations: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const scene = run % 2 === 0 ? { id: 'BLACKOUT' as const } : { id: 'BRACKET' as const };
      const started = performance.now();
      showScene(host, scene);
      durations.push(performance.now() - started);
    }

    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(64);
    const observed = median(durations);
    expect(observed, `median scene switch was ${observed.toFixed(2)} ms`).toBeLessThan(BUDGET_MS);
  });
});
