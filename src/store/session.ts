import { createBeamerStore, type BeamerStore } from '@/store/beamerStore';
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
