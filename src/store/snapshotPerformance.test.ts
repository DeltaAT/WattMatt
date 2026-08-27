import { describe, expect, it } from 'vitest';

import { buildBracket } from '@/domain/bracket';
import { groupIdSchema, matchIdSchema, roundIdSchema, tableIdSchema } from '@/domain/ids';
import { createRng } from '@/domain/rng';
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

/**
 * The heaviest picture the channel carries today: 64 groups on 32 tables, every
 * one of them busy.
 *
 * The 16 ms floor was measured against groups alone (docs/OPEN-QUESTIONS.md
 * #19); issue #13 put tables and the matches on them into the snapshot, so it is
 * measured against those too — a 64-group event is exactly the one that also
 * runs the most tables.
 */
function fullHouse(): TournamentSnapshot {
  const matches = Array.from({ length: 32 }, (_, index) => ({
    id: matchIdSchema.parse(`match-${index + 1}`),
    tableId: tableIdSchema.parse(`table-${index + 1}`),
    a: groupIdSchema.parse(`group-${index * 2 + 1}`),
    b: groupIdSchema.parse(`group-${index * 2 + 2}`),
    winnerId: null,
    status: 'RUNNING' as const,
  }));

  return {
    name: 'Sommerturnier',
    groups: Array.from({ length: 64 }, (_, index) => ({
      id: groupIdSchema.parse(`group-${index + 1}`),
      number: index + 1,
      name: `Mannschaft ${index + 1}`,
      status: 'ACTIVE' as const,
    })),
    participantLabel: 'GROUP' as const,
    performanceMode: false,
    tables: matches.map((match, index) => ({
      id: tableIdSchema.parse(`table-${index + 1}`),
      label: `Tisch ${index + 1}`,
      status: 'OCCUPIED' as const,
      currentMatchId: match.id,
      occupiedSince: '2026-08-23T10:00:00+02:00',
    })),
    matches,
    // Issue #25 sends the `Turnierbaum` too, and this is the heaviest one there
    // is: a field of 16 is the largest bracket §7 names.
    bracket: buildBracket(
      Array.from({ length: 16 }, (_unused, index) => ({
        id: groupIdSchema.parse(`group-${index + 1}`),
        number: index + 1,
        name: `Mannschaft ${index + 1}`,
        status: 'ACTIVE' as const,
      })),
      { rng: createRng('performance') },
    ),
    // Issue #18 widened the snapshot to carry the round the matches belong to,
    // so the measured payload carries one too — 32 pairings is exactly the
    // draw size that issue names as the worst case.
    round: {
      id: roundIdSchema.parse('round-1'),
      index: 1,
      kind: 'QUALIFYING' as const,
      track: 'MAIN' as const,
      label: 'Runde 1',
      state: 'DRAWN' as const,
    },
    // A field of 64 leaves 32 winners standing, which is already a power of two
    // — docs/TOURNAMENT-RULES.md §4 skips the phase outright for it (issue #21).
    consolationRound: null,
    consolationMatches: [],
    repechage: null,
    // Issue #22 put the closed rounds on the wire too, so the host can point
    // the projector back at one. The heaviest moment of a 64-group event is the
    // elimination round running with the qualifying round already behind it, so
    // the measured payload carries a full round of history as well as the live
    // one.
    history: [
      {
        id: roundIdSchema.parse('round-0'),
        index: 1,
        kind: 'QUALIFYING' as const,
        track: 'MAIN' as const,
        label: 'Runde 1',
        state: 'CLOSED' as const,
        matches: matches.map((match) => ({ ...match, winnerId: match.a, status: 'DONE' as const })),
      },
    ],
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('snapshot round-trip performance', () => {
  it('delivers a 64-group tournament on 32 tables to the beamer inside one frame', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    const beamer = createBeamerStore();
    await startHostSync(host, transports.host);
    await startBeamerSync(beamer, transports.beamer);

    const tournament = fullHouse();
    const durations: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      // A fresh object each run: an identical reference would take the light
      // channel and measure the wrong thing entirely.
      const payload: TournamentSnapshot = {
        name: tournament.name,
        groups: [...tournament.groups],
        participantLabel: tournament.participantLabel,
        performanceMode: tournament.performanceMode,
        tables: [...tournament.tables],
        matches: [...tournament.matches],
        round: tournament.round,
        consolationRound: tournament.consolationRound,
        consolationMatches: [...tournament.consolationMatches],
        repechage: tournament.repechage,
        bracket: tournament.bracket,
        history: [...tournament.history],
      };

      const started = performance.now();
      host.commit(() => ({ tournament: payload }));
      durations.push(performance.now() - started);

      expect(beamer.getState().snapshot.tournament.groups).toHaveLength(64);
      expect(beamer.getState().snapshot.tournament.tables).toHaveLength(32);
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

    host.commit(() => ({ tournament: fullHouse() }));

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
