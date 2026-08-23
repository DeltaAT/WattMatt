import { describe, expect, it } from 'vitest';

import { BLACKOUT_SCENE, IDLE_SCENE } from '@/domain/beamerScene';
import { group, tournament } from '@/domain/testFixtures';
import {
  closeDocument,
  setDocumentSaved,
  setNewDocument,
  setOpenedDocument,
} from '@/store/actions/document';
import { showScene } from '@/store/actions/scene';
import {
  createTournamentStore,
  hasUnsavedChanges,
  type TournamentStore,
} from '@/store/tournamentStore';

const PATH = 'C:\\Turniere\\Sommer.wattmatt';
/** Where "Speichern unter…" put it instead. */
const OTHER_PATH = 'E:\\Stick\\Sommer.wattmatt';

/** Stands in for the mutating actions later issues add (#13, #14, #16, …). */
function renameTournament(store: TournamentStore, name: string): void {
  store.commit((state) => ({
    document: state.document === null ? null : { ...state.document, name },
  }));
}

describe('document actions', () => {
  it('a new tournament is open, unwritten, and therefore unsaved', () => {
    const store = createTournamentStore();

    setNewDocument(store, tournament({ name: 'Sommer' }));

    expect(store.getState().document?.name).toBe('Sommer');
    expect(store.getState().file).toEqual({ status: 'unsaved' });
    expect(hasUnsavedChanges(store.getState())).toBe(true);
  });

  it('an opened tournament matches its file and has nothing to save', () => {
    const store = createTournamentStore();

    setOpenedDocument(store, tournament(), PATH);

    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(hasUnsavedChanges(store.getState())).toBe(false);
  });

  /**
   * The point of deriving this centrally: an action written by a later issue
   * cannot forget to say that it changed something. If it could, the host would
   * be free to close the window on a round nobody wrote down.
   */
  it('any action that touches the tournament marks it modified', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);

    renameTournament(store, 'Sommerturnier');

    expect(store.getState().file).toEqual({ status: 'modified', path: PATH });
    expect(hasUnsavedChanges(store.getState())).toBe(true);
  });

  it('an action that leaves the tournament alone does not mark it modified', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);

    showScene(store, BLACKOUT_SCENE);

    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
  });

  it('a tournament that never reached disk stays unsaved rather than becoming modified', () => {
    const store = createTournamentStore();
    setNewDocument(store, tournament());

    renameTournament(store, 'Sommerturnier');

    expect(store.getState().file).toEqual({ status: 'unsaved' });
  });

  it('recording a save clears the modified state and follows the new path', () => {
    const store = createTournamentStore();
    setNewDocument(store, tournament());

    setDocumentSaved(store, PATH, store.getState().revision);

    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(hasUnsavedChanges(store.getState())).toBe(false);
  });

  /**
   * The write is asynchronous and the host keeps clicking during it — at the
   * 500 ms autosave cadence, most writes overlap the next decision (issue #10).
   * Reporting the file as clean would tell the host a result is safe when it is
   * not in the bytes on disk, and the crash a second later would prove it.
   */
  it('stays modified when the tournament moved on while the bytes were in flight', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);
    const serialisedRevision = store.getState().documentRevision;

    renameTournament(store, 'Sommerturnier');
    setDocumentSaved(store, PATH, serialisedRevision);

    expect(store.getState().file).toEqual({ status: 'modified', path: PATH });
    expect(hasUnsavedChanges(store.getState())).toBe(true);
  });

  /**
   * The beamer controls commit too. A host who staged a scene while an autosave
   * was in flight would otherwise be told the tournament is unsaved when the
   * file is perfectly current — and would be charged a redundant write and a
   * backup rotation for it every time (issue #10).
   */
  it('stays saved when only the beamer moved while the bytes were in flight', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);
    const serialisedRevision = store.getState().documentRevision;

    showScene(store, BLACKOUT_SCENE);
    setDocumentSaved(store, PATH, serialisedRevision);

    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
    // The commit counter did move — this is exactly the difference the file
    // state must not be keyed on.
    expect(store.getState().revision).toBeGreaterThan(serialisedRevision);
  });

  it('follows the new path even when the tournament moved on during the write', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);
    const serialisedRevision = store.getState().documentRevision;

    renameTournament(store, 'Sommerturnier');
    setDocumentSaved(store, OTHER_PATH, serialisedRevision);

    expect(store.getState().file).toEqual({ status: 'modified', path: OTHER_PATH });
  });

  it('closing leaves nothing of the previous tournament behind', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament({ groups: [group(1)] }), PATH);
    showScene(store, BLACKOUT_SCENE);

    closeDocument(store);

    expect(store.getState().document).toBeNull();
    expect(store.getState().tournament).toEqual({ groups: [] });
    expect(hasUnsavedChanges(store.getState())).toBe(false);
  });

  /**
   * The scene names things that no longer exist once a different tournament is
   * open — a round id from the previous evening. Leaving it up would show the
   * audience the last event while the tournament leader sets up the next one.
   */
  it('switching tournaments returns the beamer to idle and to auto-follow', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament(), PATH);
    showScene(store, BLACKOUT_SCENE);

    setOpenedDocument(store, tournament({ name: 'Anderes' }), 'C:\\Turniere\\Anderes.wattmatt');

    expect(store.getState().scene).toEqual(IDLE_SCENE);
    expect(store.getState().autoFollow).toBe(true);
  });

  it('keeps the beamer projection in step with the tournament', () => {
    const store = createTournamentStore();
    setOpenedDocument(store, tournament({ groups: [group(1)] }), PATH);

    store.commit((state) => ({
      document:
        state.document === null ? null : { ...state.document, groups: [group(1), group(2)] },
    }));

    expect(store.getState().tournament.groups.map((entry) => entry.number)).toEqual([1, 2]);
  });

  it('reports a commit that changed the tournament as one the beamer needs in full', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.touchedTournament));

    setNewDocument(store, tournament());
    showScene(store, BLACKOUT_SCENE);

    expect(seen).toEqual([true, false]);
  });
});
