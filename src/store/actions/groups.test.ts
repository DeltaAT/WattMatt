import { describe, expect, it } from 'vitest';

import { FIXED_NOW, fixedClock, groupId, midTournament, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { addGroups, removeGroup, setParticipantLabel } from '@/store/actions/groups';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The group actions (issue #14).
 *
 * The rules are `@/domain/groups`' and are tested there. What is checked here is
 * what an action adds: the German step the undo button reads — in the wording
 * *this* tournament uses — the audit entry the file keeps, and the two things
 * `change` refuses to do: commit with no tournament open, and commit a change
 * that changed nothing.
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

describe('addGroups', () => {
  it('creates the participants the host asked for', () => {
    const store = setup();

    addGroups(store, 3);

    expect(documentOf(store).groups.map((group) => group.number)).toEqual([1, 2, 3]);
  });

  it('names the step on the undo button and appends one audit entry', () => {
    const store = setup();

    addGroups(store, 3);

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.groupsAdded({ participants: de.participant.GROUP.count({ n: 3 }) }),
    );
    expect(lastLog(store)).toMatchObject({
      at: FIXED_NOW,
      action: 'GROUPS_ADDED',
      payload: { count: 3, groupIds: ['grp_1', 'grp_2', 'grp_3'] },
    });
  });

  /* The host reads the undo button in the words they chose for this evening. */
  it('reads the undo step in the wording this tournament uses', () => {
    const store = setup(
      tournament({ settings: { ...tournament().settings, participantLabel: 'TEAM' } }),
    );

    addGroups(store, 2);

    expect(nextUndo(store.getState().history)?.label).toBe('2 Teams angelegt');
  });

  /* 40 participants is one decision, so it is one step back out again — not 40
   * presses of Ctrl+Z (CLAUDE.md golden rule 6). */
  it('takes a whole bulk add back in one step', () => {
    const store = setup();
    addGroups(store, 40);

    store.undo();

    expect(documentOf(store).groups).toEqual([]);
    // Including the counter: an undo says the forty never happened, so the next
    // `+` is participant one again — unlike a *deletion*, which says they did.
    expect(documentOf(store).nextGroupNumber).toBe(1);
  });

  it.each([0, -1])('does nothing at all for a count of %s', (count) => {
    const store = setup();
    const before = store.getState();

    addGroups(store, count);

    expect(store.getState()).toBe(before);
  });

  /* The controls live with the tournament, so this can only be a click that
   * arrived after the host closed one. */
  it('does nothing with no tournament open', () => {
    const store = createTournamentStore();
    const before = store.getState();

    addGroups(store, 4);

    expect(store.getState()).toBe(before);
  });
});

describe('removeGroup', () => {
  it('takes the participant out and names them on the undo button', () => {
    const store = setup();
    addGroups(store, 3);

    removeGroup(store, groupId(2));

    expect(documentOf(store).groups.map((group) => group.number)).toEqual([1, 3]);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.groupRemoved({
        participant: de.participant.GROUP.numbered({ n: 2 }),
      }),
    );
  });

  it('records the number in the audit log, where the id alone would not help', () => {
    const store = setup();
    addGroups(store, 2);

    removeGroup(store, groupId(2));

    expect(lastLog(store)).toMatchObject({
      action: 'GROUP_REMOVED',
      payload: { groupId: 'grp_2', number: 2 },
    });
  });

  it('puts the participant back, with the same number, on undo', () => {
    const store = setup();
    addGroups(store, 3);
    const before = documentOf(store).groups;

    removeGroup(store, groupId(2));
    store.undo();

    expect(documentOf(store).groups).toEqual(before);
  });

  /* A refused removal must not commit: a step on the stack that undoes nothing
   * is worse than a button that did not react. */
  it('does not commit for a participant who has already been drawn', () => {
    const store = setup(midTournament());
    const before = store.getState();

    removeGroup(store, groupId(1));

    expect(store.getState()).toBe(before);
  });
});

describe('setParticipantLabel', () => {
  it('switches the wording and says so on the undo button', () => {
    const store = setup();

    setParticipantLabel(store, 'PLAYER');

    expect(documentOf(store).settings.participantLabel).toBe('PLAYER');
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.participantLabelSet({ participants: de.participant.PLAYER.many }),
    );
    expect(lastLog(store)).toMatchObject({
      action: 'PARTICIPANT_LABEL_SET',
      payload: { participantLabel: 'PLAYER' },
    });
  });

  it('reaches the beamer, so the projector never calls them something else', () => {
    const store = setup();

    setParticipantLabel(store, 'TEAM');

    expect(store.getState().tournament.participantLabel).toBe('TEAM');
  });

  it('does not commit when the wording is already that one', () => {
    const store = setup();
    const before = store.getState();

    setParticipantLabel(store, 'GROUP');

    expect(store.getState()).toBe(before);
  });
});
