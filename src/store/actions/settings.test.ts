import { describe, expect, it } from 'vitest';

import { FIXED_NOW, fixedClock, midTournament, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { setNamingAt, setPerformanceMode, setTournamentName } from '@/store/actions/settings';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The settings actions (issue #15).
 *
 * The rules are `@/domain/settings`' and are tested there. What is checked here
 * is what an action adds: the German step the undo button reads, the audit entry
 * the file keeps, that undo puts the previous value back exactly, and the two
 * things `change` refuses to do — commit with no tournament open, and commit a
 * change that changed nothing.
 */

function setup(document: Tournament = tournament()): TournamentStore {
  return createTournamentStore(
    { ...INITIAL_TOURNAMENT_STATE, document, file: { status: 'saved', path: 'C:\\T.wattmatt' } },
    { clock: fixedClock() },
  );
}

const documentOf = (store: TournamentStore): Tournament => {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

const lastLog = (store: TournamentStore) => documentOf(store).log.at(-1);

describe('setTournamentName', () => {
  it('renames the tournament and names the step on the undo button', () => {
    const store = setup();

    setTournamentName(store, '  Herbstturnier  ');

    expect(documentOf(store).name).toBe('Herbstturnier');
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.tournamentRenamed({ name: 'Herbstturnier' }),
    );
    expect(lastLog(store)).toMatchObject({
      at: FIXED_NOW,
      action: 'TOURNAMENT_RENAMED',
      payload: { name: 'Herbstturnier' },
    });
  });

  it('puts the old name back on undo', () => {
    const store = setup(tournament({ name: 'Sommerturnier' }));

    setTournamentName(store, 'Herbstturnier');
    store.undo();

    expect(documentOf(store).name).toBe('Sommerturnier');
  });

  it('does not commit an empty name', () => {
    const store = setup();
    const before = store.getState().revision;

    setTournamentName(store, '   ');

    expect(store.getState().revision).toBe(before);
  });
});

describe('setNamingAt', () => {
  it('moves the threshold and records it', () => {
    const store = setup();

    setNamingAt(store, 8);

    expect(documentOf(store).settings.namingAt).toBe(8);
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.namingAtSet({ n: 8 }));
    expect(lastLog(store)).toMatchObject({ action: 'NAMING_AT_SET', payload: { namingAt: 8 } });
  });

  it('restores the previous threshold exactly on undo', () => {
    const store = setup();
    const before = documentOf(store).settings;

    setNamingAt(store, 4);
    store.undo();

    expect(documentOf(store).settings).toEqual(before);
  });

  /* Locked from the naming phase on — `midTournament` is in `BRACKET`. */
  it('does not commit once names have been asked for', () => {
    const store = setup(midTournament());
    const before = store.getState().revision;

    setNamingAt(store, 4);

    expect(store.getState().revision).toBe(before);
  });

  it('does not commit a threshold the domain refuses', () => {
    const store = setup();
    const before = store.getState().revision;

    setNamingAt(store, 1);

    expect(store.getState().revision).toBe(before);
  });
});

describe('setPerformanceMode', () => {
  it('turns the cheap motion on, names it, and sends it to the beamer', () => {
    const store = setup();

    setPerformanceMode(store, true);

    expect(documentOf(store).settings.performanceMode).toBe(true);
    // The projection is what the beamer is handed; a setting the host can see
    // and the projector cannot is the disagreement golden rule 4 forbids.
    expect(store.getState().tournament.performanceMode).toBe(true);
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.performanceModeOn);
    expect(lastLog(store)).toMatchObject({
      action: 'PERFORMANCE_MODE_SET',
      payload: { performanceMode: true },
    });
  });

  it('names turning it off differently, so the undo button says which', () => {
    const store = setup();

    setPerformanceMode(store, true);
    setPerformanceMode(store, false);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.performanceModeOff);
  });

  it('does not commit when the mode is already what was asked for', () => {
    const store = setup();
    const before = store.getState().revision;

    setPerformanceMode(store, false);

    expect(store.getState().revision).toBe(before);
  });
});

describe('with no tournament open', () => {
  it('commits nothing at all', () => {
    const store = createTournamentStore(INITIAL_TOURNAMENT_STATE, { clock: fixedClock() });

    setTournamentName(store, 'Turnier');
    setNamingAt(store, 8);
    setPerformanceMode(store, true);

    expect(store.getState().revision).toBe(0);
    expect(store.getState().document).toBeNull();
  });
});
