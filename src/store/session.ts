import { createLoopbackChannel } from '@/platform/windowSync';
import { createBeamerStore, type BeamerStore } from '@/store/beamerStore';
import type { SyncTransport } from '@/store/syncContract';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

/**
 * The one store each window owns, for the window's whole lifetime.
 *
 * Module-level rather than React context: the sync layer has to reach the store
 * from outside the component tree, and a store that is recreated by a re-render
 * would drop the beamer's picture on the floor.
 *
 * Only one of these is ever used in a given window — the host never touches the
 * beamer view, and the beamer has no way to touch the tournament.
 */

export const tournamentStore: TournamentStore = createTournamentStore();
export const beamerViewStore: BeamerStore = createBeamerStore();

/**
 * The host's own copy of the beamer picture, behind the live preview
 * thumbnail (issue #28, docs/STYLEGUIDE.md §4).
 *
 * A second beamer store rather than a read of the tournament store, because the
 * preview has to answer a different question: not "what has the host decided?"
 * but "what is on the wall right now?" — which is not the same thing while the
 * picture is frozen, while a draw is still playing out, or while the projector
 * is catching up. It is fed by the loopback leg of the host channel below, so
 * the answer comes from the same messages the projector acts on.
 *
 * Unfrozen, unlike the beamer window's store. The snapshots it is handed are
 * the host's own objects rather than deserialised copies, and freezing them
 * would reach back into the tournament the host is still working on.
 */
export const beamerPreviewStore: BeamerStore = createBeamerStore(undefined, { freeze: false });

/**
 * The in-window half of the host channel, joining the host to its own preview.
 *
 * Module-level for the same reason the stores are: the sync layer wires it up
 * from outside the component tree, and a channel recreated by a re-render would
 * leave the preview holding a picture nobody is updating any more.
 */
export const previewChannel: { host: SyncTransport; beamer: SyncTransport } =
  createLoopbackChannel();
