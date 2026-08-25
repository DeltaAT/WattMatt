import { describe, expect, it } from 'vitest';

import { MAX_GROUP_NAME_LENGTH } from '@/domain/naming';
import { group, groupId, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { setGroupName } from '@/store/actions/naming';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The naming action (issue #23).
 *
 * The rules are `@/domain/naming`'s and are tested there. What is checked here
 * is what an action adds: the German the undo button reads, the audit entry the
 * file keeps, the projection the beamer is handed — and the two things it
 * refuses to do, which are committing with no tournament open and committing a
 * name the domain declined.
 */

function field(count: number, overrides: Partial<Tournament> = {}): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: Array.from({ length: count }, (_unused, index) => group(index + 1)),
    nextGroupNumber: count + 1,
    ...overrides,
  });
}

function ready(document: Tournament): TournamentStore {
  const store = createTournamentStore();
  store.commit(() => ({ document }));
  return store;
}

function open(store: TournamentStore): Tournament {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament is open');
  }
  return document;
}

describe('setGroupName', () => {
  it('stores the name in one commit', () => {
    const store = ready(field(4));
    const before = store.getState().revision;

    setGroupName(store, groupId(2), 'Die Schnellen');

    expect(store.getState().revision).toBe(before + 1);
    expect(open(store).groups[1]?.name).toBe('Die Schnellen');
  });

  /*
   * The undo button names the row, not the name: this is the button for a name
   * that is about to disappear, and labelling it with that same name would name
   * the thing being taken away rather than who it is being taken away from.
   */
  it('puts a step on the undo stack that names the participant by number', () => {
    const store = ready(field(4));

    setGroupName(store, groupId(2), 'Die Schnellen');

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.groupNamed({
        participant: de.participant.GROUP.numbered({ n: 2 }),
        name: 'Die Schnellen',
      }),
    );
  });

  it('says "geändert" rather than "erfasst" when a name is replaced', () => {
    const store = ready(field(4));

    setGroupName(store, groupId(2), 'Die Schnelen');
    setGroupName(store, groupId(2), 'Die Schnellen');

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.groupRenamed({
        participant: de.participant.GROUP.numbered({ n: 2 }),
        name: 'Die Schnellen',
      }),
    );
  });

  it('reads the undo label in the wording this tournament uses', () => {
    const store = ready(field(4, { settings: { ...field(4).settings, participantLabel: 'TEAM' } }));

    setGroupName(store, groupId(1), 'Die Schnellen');

    expect(nextUndo(store.getState().history)?.label).toContain(
      de.participant.TEAM.numbered({ n: 1 }),
    );
  });

  /* An undo has to restore the previous name exactly (CLAUDE.md §7). */
  it('is undone back to the name that was there before', () => {
    const store = ready(field(4));

    setGroupName(store, groupId(1), 'Die Schnelen');
    setGroupName(store, groupId(1), 'Die Schnellen');
    store.undo();

    expect(open(store).groups[0]?.name).toBe('Die Schnelen');

    store.undo();
    expect(open(store).groups[0]?.name).toBeNull();
  });

  it('records what the name was and what it became, for the audit trail', () => {
    const store = ready(field(4));

    setGroupName(store, groupId(1), 'Die Schnelen');
    setGroupName(store, groupId(1), 'Die Schnellen');

    const log = open(store).log;
    expect(log.at(-2)).toMatchObject({
      action: 'GROUP_NAMED',
      payload: { groupId: 'grp_1', name: 'Die Schnelen', previousName: null },
    });
    expect(log.at(-1)).toMatchObject({
      action: 'GROUP_NAMED',
      payload: { groupId: 'grp_1', name: 'Die Schnellen', previousName: 'Die Schnelen' },
    });
  });

  /* Golden rule 4: the projector must never be a decision behind the laptop. */
  it('reaches the beamer projection in the same commit', () => {
    const store = ready(field(4));

    setGroupName(store, groupId(3), 'Die Schnellen');

    expect(store.getState().tournament.groups[2]?.name).toBe('Die Schnellen');
  });

  it('commits nothing for a name the domain refuses', () => {
    const store = ready(field(4));
    const before = store.getState().revision;

    setGroupName(store, groupId(1), '   ');
    setGroupName(store, groupId(1), 'x'.repeat(MAX_GROUP_NAME_LENGTH + 1));
    setGroupName(store, groupId(99), 'Die Schnellen');

    expect(store.getState().revision).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
  });

  /*
   * Every blur reaches this. A field the host tabbed through without changing
   * must not push a step that undoes nothing.
   */
  it('commits nothing when the name did not change', () => {
    const store = ready(field(4));
    setGroupName(store, groupId(1), 'Die Schnellen');
    const before = store.getState().revision;

    setGroupName(store, groupId(1), '  Die Schnellen  ');

    expect(store.getState().revision).toBe(before);
  });

  it('does nothing at all with no tournament open', () => {
    const store = createTournamentStore();
    const before = store.getState().revision;

    setGroupName(store, groupId(1), 'Die Schnellen');

    expect(store.getState().revision).toBe(before);
    expect(store.getState().document).toBeNull();
  });
});
