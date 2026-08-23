import { IDLE_SCENE } from '@/domain/beamerScene';
import type { Tournament } from '@/domain/types';
import { UNSAVED_FILE, type TournamentStore } from '@/store/tournamentStore';

/**
 * Which tournament is open (docs/FILE-FORMAT.md, issue #9).
 *
 * Store mutations only. Reading and writing files is `@/store/persistence`,
 * which calls these once the bytes are safely on disk — an action that did I/O
 * could not be replayed by the undo stack (issue #11), and half of it would be
 * unreachable in a test.
 */

/**
 * Puts a freshly created tournament in the store, before it has a file.
 *
 * `persistence.createTournament` writes it to the library immediately
 * afterwards; the two are separate so a failed first write leaves the host with
 * a working tournament and a warning, rather than nothing.
 */
export function setNewDocument(store: TournamentStore, tournament: Tournament): void {
  store.commit(() => ({ document: tournament, file: UNSAVED_FILE, ...startingOver() }));
}

/** Replaces whatever was open with a tournament read from `path`. */
export function setOpenedDocument(
  store: TournamentStore,
  tournament: Tournament,
  path: string,
): void {
  store.commit(() => ({
    document: tournament,
    file: { status: 'saved', path },
    ...startingOver(),
  }));
}

/**
 * Records that the tournament in memory is now the tournament on disk.
 *
 * Takes the path because "Speichern unter…" changes it: from here on, every
 * later save and every autosave (issue #10) targets the new file, and the old
 * one is left exactly as it was.
 *
 * It also takes the revision the bytes were serialised from, and this is the
 * part that matters once autosave is running. A write is asynchronous, and the
 * host clicks during it — at a 500 ms cadence, most autosaves overlap with the
 * next decision. Marking the file clean regardless would report a result as
 * saved that is not in the bytes on disk, and a crash a second later would
 * lose it with the host having been told it was safe. A tournament that moved
 * on during the write therefore stays `modified`, and the autosave that is
 * already scheduled writes it.
 */
export function setDocumentSaved(
  store: TournamentStore,
  path: string,
  savedRevision: number,
): void {
  // `state.revision` is the revision *before* this commit bumps it, so it is
  // the same number the writer captured.
  store.commit((state) => ({
    file:
      state.revision === savedRevision ? { status: 'saved', path } : { status: 'modified', path },
  }));
}

/**
 * Closes the tournament and returns to the start screen.
 *
 * The caller is responsible for having asked about unsaved changes first —
 * this is the point of no return, and burying the question inside it would make
 * every future caller inherit a prompt it did not ask for.
 */
export function closeDocument(store: TournamentStore): void {
  store.commit(() => ({ document: null, file: UNSAVED_FILE, ...startingOver() }));
}

/**
 * What every document switch resets.
 *
 * The beamer must not keep showing the previous tournament's scene: the round
 * it names no longer exists, and the audience would be looking at the last
 * event while the host sets up the next one. Auto-follow comes back on because
 * a new document is not a moment the host has taken manual control in.
 */
function startingOver() {
  return { scene: IDLE_SCENE, autoFollow: true };
}
