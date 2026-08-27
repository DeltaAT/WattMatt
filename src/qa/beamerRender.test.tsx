// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Phase } from '@/domain/types';
import { reopenBeamer } from '@/qa/checks';
import { runDryRun, type DryRunSpec, type RepechagePolicy } from '@/qa/dryRun';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { SafeBeamerPicture } from '@/windows/beamer/SafeBeamerPicture';

/**
 * The other half of "the beamer picture is correct after closing and reopening
 * the beamer window" (CLAUDE.md §7, issue #33).
 *
 * `dryRun.test.ts` checks that the reopened window is *handed* the right
 * picture. This one checks that it can *draw* it: the view a reopened beamer
 * receives in every phase of every scenario is rendered through the same
 * component the projector uses, error boundary included. A snapshot the beamer
 * cannot render is a holding scene in front of fifty people (issue #30), and
 * the snapshot check alone would call that a pass.
 *
 * One render per phase rather than per action: what changes between two results
 * in the same round is data the scene already draws, and thirty renders that
 * cover every scene the evening stages are worth more than three hundred that
 * cover the same seven.
 */

const DECLINE_HEAVY: RepechagePolicy = {
  accepts: (drawIndex) => drawIndex >= 18,
  fallback: (attempt) => (attempt === 1 ? 'REOPEN_DECLINED' : 'BYES'),
};

const SPECS: readonly DryRunSpec[] = [
  { id: '5-groups-2-tables', groups: 5, tables: 2 },
  { id: '13-groups-3-tables', groups: 13, tables: 3 },
  { id: '40-groups-6-tables', groups: 40, tables: 6 },
  { id: '2-groups-1-table', groups: 2, tables: 1 },
  { id: 'decline-heavy', groups: 20, tables: 4, repechage: DECLINE_HEAVY },
];

/**
 * The classes docs/MOTION.md hangs the beamer's one-off animations on.
 *
 * None of them may be on the page a reopened beamer draws: replaying the flip
 * of a result the room watched ten minutes ago, or the card of a candidate who
 * has long since answered, is the exact failure golden rule 4 is about.
 */
const REPLAYS = [
  'wm-result-win',
  'wm-result-lose',
  'wm-repechage-arrive',
  'wm-repechage-accept',
  'wm-repechage-decline',
  'wm-repechage-lift',
  'wm-draw-reveal',
] as const;

/**
 * The bracket's arrival is marked by an attribute rather than a class — the
 * class beside it is a standing `transition` and is on every chip, played or
 * not (`wm-bracket-advance` in src/styles/global.css).
 */
const ARRIVING = '[data-arriving]';

afterEach(cleanup);

describe.each(SPECS)('$id', (spec) => {
  it('draws every picture a reopened beamer is handed', async () => {
    const drawn = new Map<Phase, string>();
    const failures: string[] = [];
    const onSceneFailure = vi.fn((scene: string, error: unknown) => {
      failures.push(`${scene}: ${String(error)}`);
    });

    await runDryRun(spec, {
      async afterAction({ event, store }) {
        if (drawn.has(event.phase)) {
          return;
        }

        const view = await reopenBeamer(store);
        const { container } = render(
          <BeamerSurface
            placement="projected"
            performanceMode={view.snapshot.tournament.performanceMode}
          >
            <SafeBeamerPicture view={view} onSceneFailure={onSceneFailure} />
          </BeamerSurface>,
        );

        const scene = container.querySelector('[data-scene]');
        expect(scene).not.toBeNull();
        // Settled, for the same reason the snapshot is: a beamer that has just
        // reopened shows the scene as it already is and never replays it. Most
        // scenes say so with `data-settled`; the `Hoffnungsrunde` carries the
        // same fact as a beat that is not playing, so the classes below are
        // checked whatever the scene.
        if (scene?.hasAttribute('data-settled') === true) {
          expect(scene.getAttribute('data-settled')).toBe('true');
        }
        for (const playing of REPLAYS) {
          expect(
            container.querySelector(`.${playing}`),
            `${event.phase} replayed ${playing} on a reopened beamer`,
          ).toBeNull();
        }
        expect(
          container.querySelector(ARRIVING),
          `${event.phase} flew a bracket chip in on a reopened beamer`,
        ).toBeNull();
        drawn.set(event.phase, scene?.getAttribute('data-scene') ?? '');
        cleanup();
      },
    });

    expect(failures).toEqual([]);
    expect(onSceneFailure).not.toHaveBeenCalled();
    // Every phase the evening passed through was drawn, and none of them landed
    // on the holding scene.
    expect(drawn.size).toBeGreaterThan(0);
    for (const [phase, scene] of drawn) {
      expect(scene, `phase ${phase} drew nothing`).not.toBe('');
    }
  }, 60_000);
});
