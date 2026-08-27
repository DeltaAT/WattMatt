// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BeamerScene, BeamerSceneId } from '@/domain/beamerScene';
import { buildBracket } from '@/domain/bracket';
import { groupIdSchema, matchIdSchema, roundIdSchema, tableIdSchema } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import { BeamerScenePlaceholder } from '@/windows/beamer/BeamerScenePlaceholder';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';

/**
 * The 1080p pass of issue #29, over every beamer scene at the worst field the
 * app supports: 64 groups on 32 tables (docs/MOTION.md §6).
 *
 * **What this can and cannot measure.** The §6 budget — 60 fps at 1920 × 1080
 * on integrated graphics — is spent in two places, and only one of them is
 * reachable from a test runner. jsdom has no layout and no compositor, so the
 * *paint* half has to be measured on the event laptop with the FPS overlay and
 * cannot be asserted here. What is asserted is the half that is deterministic
 * and that a refactor breaks silently:
 *
 *   1. **How many elements animate at once.** §6 caps the beamer at roughly
 *      sixty and says to animate a container above that. This is the number
 *      that quietly grows with the field: a per-card animation is free at eight
 *      groups and is sixty-four layers at sixty-four. It is a property of the
 *      markup, so it is exactly measurable here.
 *   2. **That a scene arriving does not replay the evening.** A beamer reopened
 *      mid-round is handed thirty-two decided matches, and a result flip per
 *      side would be sixty-four animations for results the room saw an hour
 *      ago — over the budget and wrong besides.
 *   3. **That every scene renders the worst case at all.** A scene that throws
 *      on 64 groups is a black projector, and the field size is the one input
 *      no test elsewhere pushes to its limit for every scene at once.
 *
 * The render *time* is checked too, generously: it catches an accidental
 * quadratic — a lookup done by scanning a 64-entry array inside a 32-item loop
 * — while staying far enough above the noise of a shared CI runner to be worth
 * having.
 */

const GROUPS = 64;
const TABLES = 32;

/** docs/MOTION.md §6: "Maximum ~60 simultaneously animated elements". */
const ANIMATED_BUDGET = 60;

/**
 * Generous by design: a scene at 1080p on a projector has a whole frame budget
 * to itself, and this measures React's share of it in an environment with no
 * layout to do. What it is looking for is an order of magnitude, not a
 * millisecond.
 */
const RENDER_BUDGET_MS = 120;

/** Every animation utility the beamer can put on an element. */
const ANIMATION_CLASSES = [
  'wm-count-pulse',
  'wm-draw-reveal',
  'wm-draw-pool-number',
  'wm-result-win',
  'wm-result-lose',
  'wm-repechage-lift',
  'wm-repechage-accept',
  'wm-repechage-arrive',
  'wm-repechage-decline',
  'wm-bracket-node',
  'wm-podium-rise',
  'wm-podium-name',
  'wm-podium-gold',
  'wm-blackout-veil',
] as const;

const ANIMATED_SELECTOR = ANIMATION_CLASSES.map((name) => `.${name}`).join(',');

const RNG_SEED = 'scene-performance';

/**
 * The heaviest picture the app can be asked to draw.
 *
 * 64 groups is the ceiling the tournament rules allow and 32 tables is what
 * runs them all at once, which is the same worst case `snapshotPerformance`
 * measures the channel against. Names are long on purpose: `useFitToStage` and
 * `nameFit` both do work proportional to how badly a label overruns, and a
 * field of `Gruppe 1` would measure the easy case.
 */
function fullHouse(overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  const groups = Array.from({ length: GROUPS }, (_unused, index) => ({
    id: groupIdSchema.parse(`group-${index + 1}`),
    number: index + 1,
    name: `Mannschaft Sonnenschein ${index + 1}`,
    status: 'ACTIVE' as const,
  }));

  const matches = Array.from({ length: TABLES }, (_unused, index) => ({
    id: matchIdSchema.parse(`match-${index + 1}`),
    tableId: tableIdSchema.parse(`table-${index + 1}`),
    a: groupIdSchema.parse(`group-${index * 2 + 1}`),
    b: groupIdSchema.parse(`group-${index * 2 + 2}`),
    // Every match decided: the state in which a reopened beamer has the most to
    // replay, and the one the result flip has to stay out of.
    winnerId: groupIdSchema.parse(`group-${index * 2 + 1}`),
    status: 'DONE' as const,
  }));

  return {
    name: 'Sommerturnier der Feuerwehr Kirchbach',
    groups,
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
    round: {
      id: roundIdSchema.parse('round-1'),
      index: 1,
      kind: 'QUALIFYING' as const,
      track: 'MAIN' as const,
      label: 'Runde 1',
      state: 'DRAWN' as const,
    },
    /*
     * The largest pot there is. A field of 64 skips the phase outright — 32
     * winners is already a power of two (docs/TOURNAMENT-RULES.md §4) — so the
     * worst case for *this* scene is one group short of that: 63 groups leave
     * 31 winners, and all 31 losers stand in the pot at once.
     */
    consolationRound: null,
    consolationMatches: [],
    repechage: {
      target: 32,
      need: 1,
      byes: 0,
      through: groups.slice(0, 31).map((group) => group.id),
      pot: groups.slice(32, 63).map((group, index) => ({
        groupId: group.id,
        status: index === 0 ? ('DRAWN' as const) : ('POOL' as const),
      })),
      last: { groupId: groups[32]?.id ?? groups[0]!.id, accepted: null },
      fallbackUsed: null,
      complete: false,
    },
    history: [
      {
        id: roundIdSchema.parse('round-0'),
        index: 1,
        kind: 'QUALIFYING' as const,
        track: 'MAIN' as const,
        label: 'Runde 1',
        state: 'CLOSED' as const,
        matches,
      },
    ],
    // 16 is the largest bracket the final phase can start at (`bracketRound`).
    bracket: buildBracket(groups.slice(0, 16), { rng: createRng(RNG_SEED) }),
    ...overrides,
  };
}

/** Every scene the host can stage, at the worst field each of them can carry. */
const SCENES: readonly BeamerScene[] = [
  { id: 'IDLE' },
  { id: 'WELCOME' },
  { id: 'BLACKOUT' },
  { id: 'GROUP_OVERVIEW' },
  { id: 'TABLE_OVERVIEW' },
  { id: 'DRAW', roundId: roundIdSchema.parse('round-1') },
  { id: 'ROUND_BOARD', roundId: roundIdSchema.parse('round-1') },
  { id: 'REPECHAGE' },
  { id: 'NAMING' },
  { id: 'BRACKET' },
  { id: 'CEREMONY' },
];

function draw(
  scene: BeamerScene,
  {
    settled = false,
    delivery = 'live',
    performanceMode = false,
  }: { settled?: boolean; delivery?: SnapshotDelivery; performanceMode?: boolean } = {},
) {
  return render(
    <BeamerSurface placement="projected" performanceMode={performanceMode}>
      <BeamerScenePlaceholder
        scene={scene}
        tournament={fullHouse({ performanceMode })}
        settled={settled}
        delivery={delivery}
        skipToken={0}
      />
    </BeamerSurface>,
  );
}

/** How many elements are running an animation in the rendered picture. */
function animatedCount(container: HTMLElement): number {
  return container.querySelectorAll(ANIMATED_SELECTOR).length;
}

afterEach(cleanup);

describe.each(SCENES.map((scene): [BeamerSceneId, BeamerScene] => [scene.id, scene]))(
  'the %s scene at 64 groups on 32 tables',
  (id, scene) => {
    it('renders the worst-case field at all', () => {
      const view = draw(scene);
      expect(view.container.querySelector(`[data-scene='${id}']`)).not.toBeNull();
    });

    it('animates no more elements at once than docs/MOTION.md §6 allows', () => {
      // Arriving live and unsettled is the loudest a scene ever is: everything
      // that can animate on entry does.
      const view = draw(scene);
      expect(animatedCount(view.container)).toBeLessThanOrEqual(ANIMATED_BUDGET);
    });

    it('animates nothing at all when it is only catching up', () => {
      // A beamer reopened mid-event, and an undo, both arrive this way. The
      // picture must be the one that already stands (golden rule 4) — which is
      // also, at this field size, the cheapest thing it could possibly be.
      const view = draw(scene, { settled: true, delivery: 'catchUp' });
      expect(animatedCount(view.container)).toBe(0);
    });

    it('renders inside the budget', () => {
      const started = performance.now();
      draw(scene);
      expect(performance.now() - started).toBeLessThan(RENDER_BUDGET_MS);
    });

    it('draws the same picture in performance mode, only cheaper', () => {
      // The issue's third acceptance criterion: performance mode never breaks a
      // layout. Whatever the scene draws, it draws the same elements — the mode
      // is durations, glow and blur, and none of those is an element.
      const plain = draw(scene).container.querySelectorAll('[data-scene] *').length;
      cleanup();
      const cheap = draw(scene, { performanceMode: true }).container.querySelectorAll(
        '[data-scene] *',
      ).length;

      // The ceremony's particle layer is the one exception, and it is the one
      // §6 names: performance mode drops the confetti burst.
      expect(cheap).toBeLessThanOrEqual(plain);
      expect(plain - cheap).toBeLessThanOrEqual(id === 'CEREMONY' ? 1 : 0);
    });
  },
);

describe('the round board, which is where the count would run away', () => {
  const board: BeamerScene = { id: 'ROUND_BOARD', roundId: roundIdSchema.parse('round-1') };

  /** The same board with one more match decided than it had. */
  function withDecided(count: number): TournamentSnapshot {
    const full = fullHouse();
    return {
      ...full,
      matches: full.matches.map((match, index) =>
        index < count ? match : { ...match, winnerId: null, status: 'RUNNING' as const },
      ),
    };
  }

  function board64(tournament: TournamentSnapshot, delivery: SnapshotDelivery = 'live') {
    return (
      <BeamerSurface placement="projected" performanceMode={false}>
        <BeamerScenePlaceholder
          scene={board}
          tournament={tournament}
          settled
          delivery={delivery}
          skipToken={0}
        />
      </BeamerSurface>
    );
  }

  it('flips exactly the two sides of the match that was just decided', () => {
    // The animation still has to exist: this is what a live result looks like
    // on a board the room is already watching (docs/MOTION.md §4.2). One
    // result, two sides — never the thirty-one that were decided before it.
    const view = render(board64(withDecided(31)));
    view.rerender(board64(withDecided(32)));

    expect(view.container.querySelectorAll('.wm-result-win')).toHaveLength(1);
    expect(view.container.querySelectorAll('.wm-result-lose')).toHaveLength(1);
  });

  it('flips again when the host corrects a result', () => {
    // Marking the wrong winner and putting it right is a card turning over the
    // other way, not a card that quietly changed colour.
    const decided = withDecided(32);
    const corrected: TournamentSnapshot = {
      ...decided,
      matches: decided.matches.map((match, index) =>
        index === 0 ? { ...match, winnerId: match.b } : match,
      ),
    };

    const view = render(board64(decided));
    view.rerender(board64(corrected));

    expect(view.container.querySelectorAll('.wm-result-win')).toHaveLength(1);
  });

  it('replays nothing when the board is only arriving', () => {
    // 32 decided matches is 64 sides. Before issue #29 every one of them
    // animated the moment the window opened.
    const view = draw(board, { settled: false, delivery: 'catchUp' });
    expect(view.container.querySelectorAll('.wm-result-win, .wm-result-lose')).toHaveLength(0);

    // The results are still *there* — they are simply not replayed.
    expect(view.container.querySelectorAll("[data-outcome='WINNER']").length).toBe(TABLES);
  });

  it('replays nothing when an undo walks a result back', () => {
    // An undo arrives as `catchUp` (issue #11). The card that was decided is
    // open again, and nothing about that is a moment to animate.
    const view = render(board64(withDecided(32)));
    view.rerender(board64(withDecided(31), 'catchUp'));

    expect(view.container.querySelectorAll('.wm-result-win, .wm-result-lose')).toHaveLength(0);
  });
});

describe('the draw pool, which is the other one', () => {
  const drawScene: BeamerScene = { id: 'DRAW', roundId: roundIdSchema.parse('round-1') };

  it('pulses the pool as one container rather than one number at a time', () => {
    // The pool at the start of a 64-group draw is 64 elements. §6 says to
    // animate the container above sixty, so exactly one thing pulses.
    const view = draw(drawScene, { settled: false, delivery: 'live' });
    expect(view.container.querySelectorAll('.wm-draw-pool-number')).toHaveLength(1);
  });
});
