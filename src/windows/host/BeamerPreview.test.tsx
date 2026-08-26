// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { midTournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { mergeTransports } from '@/platform/windowSync';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { setFrozen, showScene } from '@/store/actions/scene';
import { beamerPreviewStore, previewChannel, tournamentStore } from '@/store/session';
import { startBeamerSync, startHostSync } from '@/store/sync';
import { BeamerPreview } from '@/windows/host/BeamerPreview';

/**
 * The live preview thumbnail (issue #28).
 *
 * "The preview matches the beamer" is the acceptance criterion, and the only
 * way to make it a property rather than a promise is to feed the thumbnail from
 * the channel the projector is on — so this test wires the real host sync to
 * the real loopback channel and renders the real component. Nothing here reads
 * the tournament store directly, which is the whole point: a preview built from
 * the host's own state would show what the host has decided rather than what
 * the room can see.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

let stop: () => void = () => {};

beforeEach(async () => {
  closeDocument(tournamentStore);
  // The same wiring `useHostSync` sets up, minus the Tauri leg there is no
  // backend for in a test.
  const host = await startHostSync(tournamentStore, mergeTransports([previewChannel.host]));
  const preview = await startBeamerSync(beamerPreviewStore, previewChannel.beamer);
  stop = () => {
    void host.stop();
    void preview.stop();
  };
  setOpenedDocument(tournamentStore, midTournament(), PATH);
});

afterEach(() => {
  cleanup();
  stop();
  closeDocument(tournamentStore);
});

function mounted(frozen = false, open = true) {
  return render(<BeamerPreview placement="projected" frozen={frozen} open={open} />);
}

describe('the live preview', () => {
  it('draws the scene the host staged, through the same channel the projector is on', () => {
    showScene(tournamentStore, { id: 'TABLE_OVERVIEW' });
    const { container } = mounted();

    expect(container.querySelector('[data-scene="TABLE_OVERVIEW"]')).not.toBeNull();
  });

  it('follows the host from one scene to the next', () => {
    showScene(tournamentStore, { id: 'TABLE_OVERVIEW' });
    const { container } = mounted();

    act(() => showScene(tournamentStore, { id: 'GROUP_OVERVIEW' }));

    expect(container.querySelector('[data-scene="GROUP_OVERVIEW"]')).not.toBeNull();
    expect(container.querySelector('[data-scene="TABLE_OVERVIEW"]')).toBeNull();
  });

  /*
   * The preview draws the blackout the same way the projector does — veil
   * first, over the picture it is covering (docs/MOTION.md §4.6). A thumbnail
   * that went black a beat before the wall did would have the host talking
   * over a picture the room can still see.
   */
  it('draws the blackout veil the projector is drawing', () => {
    showScene(tournamentStore, { id: 'TABLE_OVERVIEW' });
    const { container } = mounted();

    act(() => showScene(tournamentStore, { id: 'BLACKOUT' }));

    expect(container.querySelector('[data-blackout-veil]')).not.toBeNull();
  });

  /*
   * The case the preview exists for. While the picture is frozen the host's
   * work must not appear in the thumbnail either — it is showing the room, not
   * the laptop.
   */
  it('holds the picture the room is looking at while the host works ahead', () => {
    showScene(tournamentStore, { id: 'TABLE_OVERVIEW' });
    const { container, rerender } = mounted();

    act(() => {
      setFrozen(tournamentStore, true);
      showScene(tournamentStore, { id: 'BRACKET' });
    });
    rerender(<BeamerPreview placement="projected" frozen open />);

    expect(container.querySelector('[data-scene="TABLE_OVERVIEW"]')).not.toBeNull();
    expect(container.querySelector('[data-scene="BRACKET"]')).toBeNull();
    // And says so, because a frozen thumbnail looks exactly like a working one.
    expect(container.textContent).toContain(de.beamerControl.freeze.badge);
  });

  it('catches up the moment the host releases the picture', () => {
    showScene(tournamentStore, { id: 'TABLE_OVERVIEW' });
    const { container } = mounted();

    act(() => {
      setFrozen(tournamentStore, true);
      showScene(tournamentStore, { id: 'BRACKET' });
      setFrozen(tournamentStore, false);
    });

    expect(container.querySelector('[data-scene="BRACKET"]')).not.toBeNull();
  });

  it('says so when there is no beamer window to mirror', () => {
    const { container } = mounted(false, false);

    expect(container.textContent).toContain(de.beamerControl.preview.closed);
  });

  /*
   * The surface installs window-level listeners that suppress the context menu
   * and text selection — right for a projector and wrong for a thumbnail
   * sitting inside the host's own controls.
   */
  it('keeps its hands off the host window it is embedded in', () => {
    mounted();

    const contextMenu = new window.MouseEvent('contextmenu', { cancelable: true });
    window.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });
});
