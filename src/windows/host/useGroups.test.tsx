// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { groupId, midTournament, tournament } from '@/domain/testFixtures';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useGroups, type GroupsHandle } from '@/windows/host/useGroups';

/**
 * The wire between the group panel and the store (issue #14).
 *
 * The store is the real one: what is being checked is that a click reaches it,
 * that the grid redraws when it does, and that the grid the host reads is the
 * same projection the beamer is sent — the two disagreeing about who is playing
 * is the failure golden rule 4 exists to prevent.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, tournament(), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<GroupsHandle, void>(() => useGroups());

describe('the group handle', () => {
  it('reads the field out of the tournament the host has open', () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const { result } = mounted();

    expect(result.current.groups.map((group) => group.number)).toEqual([1, 2, 3, 4]);
  });

  it('redraws when a participant is added', () => {
    const { result } = mounted();

    act(() => result.current.add(3));

    expect(result.current.groups.map((group) => group.number)).toEqual([1, 2, 3]);
  });

  it('removes through the store, without renumbering the rest', () => {
    const { result } = mounted();
    act(() => result.current.add(3));

    act(() => result.current.remove(groupId(2)));

    expect(result.current.groups.map((group) => group.number)).toEqual([1, 3]);
  });

  /* A participant who is already in a match cannot be taken out, and the chip
   * has to know before the host clicks (`isRemovable`). */
  it('reports which participants may still be removed', () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const { result } = mounted();

    expect(result.current.canRemove(groupId(1))).toBe(false);

    act(() => result.current.add(1));

    expect(result.current.canRemove(groupId(5))).toBe(true);
  });

  it('reports whether a round has been drawn, so a late entry is warned about', () => {
    const { result } = mounted();
    expect(result.current.hasStarted).toBe(false);

    act(() => setOpenedDocument(tournamentStore, midTournament(), PATH));

    expect(result.current.hasStarted).toBe(true);
  });

  it('switches the wording, and the beamer hears about it', () => {
    const { result } = mounted();

    act(() => result.current.setParticipant('TEAM'));

    expect(result.current.participant).toBe('TEAM');
    expect(tournamentStore.getState().tournament.participantLabel).toBe('TEAM');
  });

  it('stages the group overview on the beamer', () => {
    const { result } = mounted();

    act(() => result.current.showOnBeamer());

    expect(tournamentStore.getState().scene).toEqual({ id: 'GROUP_OVERVIEW' });
    // Driving the beamer by hand always wins (CLAUDE.md golden rule 3).
    expect(tournamentStore.getState().autoFollow).toBe(false);
  });

  it('does nothing with no tournament open', () => {
    closeDocument(tournamentStore);
    const { result } = mounted();
    const before = tournamentStore.getState();

    act(() => result.current.add(2));

    expect(tournamentStore.getState()).toBe(before);
    expect(result.current.hasStarted).toBe(false);
  });
});
