// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLACKOUT_SCENE, IDLE_SCENE, type BeamerScene } from '@/domain/beamerScene';
import { INITIAL_SNAPSHOT } from '@/domain/snapshot';
import { de } from '@/i18n';
import type { BeamerViewState } from '@/store/beamerStore';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { SafeBeamerPicture } from '@/windows/beamer/SafeBeamerPicture';

/**
 * Issue #30's first acceptance criterion: *a deliberately thrown error in a
 * beamer scene shows a neutral picture on the projector and a clear message on
 * the host screen.*
 *
 * This file owns the projector half. The picture is replaced here rather than
 * inside a specific scene because that is what the boundary actually protects —
 * every scene, including the ones later issues will add.
 */

const THROWN = 'the scene could not be drawn';

vi.mock('@/windows/beamer/BeamerPicture', () => ({
  BeamerPicture: () => {
    throw new Error(THROWN);
  },
}));

function view(scene: BeamerScene = IDLE_SCENE): BeamerViewState {
  return { snapshot: { ...INITIAL_SNAPSHOT, scene }, animate: false };
}

/* React logs every caught error to the console by design. */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a beamer scene that throws', () => {
  it('is replaced by the neutral holding picture', () => {
    render(<SafeBeamerPicture view={view()} onSceneFailure={() => {}} />);

    expect(document.querySelector('[data-scene="HOLDING"]')).not.toBeNull();
    expect(screen.getByText(de.beamer.holdingNotice)).toBeDefined();
  });

  /*
   * The whole reason the fallback is what it is. Fifty people are looking at
   * this screen, and anything on it that reads as a failure is something the
   * host spends the next ten minutes being asked about instead of running the
   * tournament.
   */
  it('shows the audience nothing about the failure', () => {
    render(<SafeBeamerPicture view={view()} onSceneFailure={() => {}} />);

    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain(THROWN);
    expect(shown).not.toContain('Error');
    expect(shown).not.toContain('Fehler');
  });

  it('tells the host which scene failed, and hands over the exception', () => {
    const onSceneFailure = vi.fn();
    render(<SafeBeamerPicture view={view()} onSceneFailure={onSceneFailure} />);

    expect(onSceneFailure).toHaveBeenCalledTimes(1);
    expect(onSceneFailure.mock.calls[0]?.[0]).toBe('IDLE');
    expect((onSceneFailure.mock.calls[0]?.[1] as Error).message).toBe(THROWN);
  });

  /*
   * The surface is the difference between a neutral picture and a web page:
   * it owns the background, the letterbox bars and the hidden cursor. A
   * boundary above it would take all three away with the scene.
   */
  it('keeps the presentation surface around the holding picture', () => {
    render(
      <BeamerSurface placement="projected" performanceMode={false}>
        <SafeBeamerPicture view={view()} onSceneFailure={() => {}} />
      </BeamerSurface>,
    );

    expect(document.querySelector('.beamer-root')).not.toBeNull();
    expect(document.querySelector('.beamer-stage')).not.toBeNull();
    expect(document.querySelector('[data-scene="HOLDING"]')).not.toBeNull();
  });

  /*
   * The host's way out, and the reason the fallback needs no button of its
   * own: the beamer window has no controls at all (docs/STYLEGUIDE.md §3), so
   * every recovery has to be reachable from the laptop. Staging any other
   * scene — the blackout is one key away — makes the projector try again.
   */
  it('tries again once the host stages a different scene', () => {
    const failure = vi.fn();
    const first = render(<SafeBeamerPicture view={view()} onSceneFailure={failure} />);
    expect(failure).toHaveBeenCalledTimes(1);

    first.rerender(<SafeBeamerPicture view={view(BLACKOUT_SCENE)} onSceneFailure={failure} />);

    // It throws again, because the mocked picture always does — but it *tried*,
    // which is the property that matters. A boundary that latched for good
    // would leave the room on the holding picture for the rest of the evening.
    expect(failure).toHaveBeenCalledTimes(2);
    expect(failure.mock.calls[1]?.[0]).toBe('BLACKOUT');
  });

  /*
   * A snapshot arrives on every commit. Re-rendering the broken tree each time
   * would report the same failure dozens of times per round and fill the log
   * with it.
   */
  it('does not report again for every snapshot of the same scene', () => {
    const failure = vi.fn();
    const first = render(<SafeBeamerPicture view={view()} onSceneFailure={failure} />);

    first.rerender(<SafeBeamerPicture view={view()} onSceneFailure={failure} />);
    first.rerender(<SafeBeamerPicture view={view()} onSceneFailure={failure} />);

    expect(failure).toHaveBeenCalledTimes(1);
  });
});
