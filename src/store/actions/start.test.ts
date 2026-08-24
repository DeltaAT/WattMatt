import { describe, expect, it } from 'vitest';

import { fixedClock, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { startTournament } from '@/store/actions/start';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * Starting the tournament (issue #15).
 *
 * The checks themselves are `@/domain/start`'s and are tested there. What is
 * checked here is what the action adds: that a tournament that cannot start
 * does not commit anything at all, that the one that can is saved *now* rather
 * than in half a second, and that the step is on the undo stack like every
 * other decision (CLAUDE.md golden rule 6).
 */

function setup(document: Tournament): TournamentStore {
  return createTournamentStore(
    { ...INITIAL_TOURNAMENT_STATE, document, file: { status: 'saved', path: 'C:\\T.wattmatt' } },
    { clock: fixedClock() },
  );
}

const ready = (overrides: Partial<Tournament> = {}) =>
  tournament({ groups: [group(1), group(2)], tables: [table(1)], ...overrides });

const documentOf = (store: TournamentStore): Tournament => {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

describe('startTournament', () => {
  it('moves a ready tournament into the qualifying phase', () => {
    const store = setup(ready());

    startTournament(store);

    expect(documentOf(store).phase).toBe('QUALIFYING');
  });

  it('names the step and records it in the audit log', () => {
    const store = setup(ready());

    startTournament(store);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.tournamentStarted);
    expect(documentOf(store).log.at(-1)).toMatchObject({
      action: 'TOURNAMENT_STARTED',
      payload: { phase: 'QUALIFYING' },
    });
  });

  /*
   * A phase change is one of the moments `CommitOptions.urgent` exists for: a
   * crash in the next half-second must not hand back a tournament that had not
   * started (docs/FILE-FORMAT.md rule 4).
   */
  it('asks for the save immediately rather than through the debounce', () => {
    const store = setup(ready());
    const urgent: boolean[] = [];
    store.onCommit((_state, meta) => urgent.push(meta.urgent));

    startTournament(store);

    expect(urgent).toEqual([true]);
  });

  it('puts the tournament back in SETUP on undo', () => {
    const store = setup(ready());

    startTournament(store);
    store.undo();

    expect(documentOf(store).phase).toBe('SETUP');
  });

  it.each([
    ['one participant', ready({ groups: [group(1)] })],
    ['no table', ready({ tables: [] })],
    ['every table out of service', ready({ tables: [table(1, { status: 'DISABLED' })] })],
    ['a tournament already under way', ready({ phase: 'QUALIFYING' })],
  ])('commits nothing for %s', (_case, document) => {
    const store = setup(document);

    startTournament(store);

    expect(store.getState().revision).toBe(0);
  });

  it('does nothing with no tournament open', () => {
    const store = createTournamentStore(INITIAL_TOURNAMENT_STATE, { clock: fixedClock() });

    startTournament(store);

    expect(store.getState().revision).toBe(0);
  });
});
