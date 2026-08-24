// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { midTournament, tournament } from '@/domain/testFixtures';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useSettings, type SettingsHandle } from '@/windows/host/useSettings';

/**
 * The wire between the settings panel and the store (issue #15).
 *
 * The store is the real one: what is being checked is that a change reaches it,
 * that the panel redraws when it does, and that a setting the beamer needs
 * arrives in the projection the beamer is sent — the host screen and the
 * projector disagreeing is the failure golden rule 4 exists to prevent.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, tournament({ name: 'Sommerturnier' }), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<SettingsHandle, void>(() => useSettings());

describe('the settings handle', () => {
  it('reads the tournament the host has open', () => {
    const { result } = mounted();

    expect(result.current.name).toBe('Sommerturnier');
    expect(result.current.settings.namingAt).toBe(16);
    expect(result.current.rngSeed).toBe('seed');
  });

  it('redraws when the tournament is renamed', () => {
    const { result } = mounted();

    act(() => result.current.rename('Herbstturnier'));

    expect(result.current.name).toBe('Herbstturnier');
    expect(tournamentStore.getState().document?.name).toBe('Herbstturnier');
  });

  it('moves the naming threshold through the store', () => {
    const { result } = mounted();

    act(() => result.current.setNamingAt(8));

    expect(result.current.settings.namingAt).toBe(8);
  });

  /* Locked from the naming phase on — `midTournament` is in `BRACKET`. */
  it('reports the threshold as locked once names have been asked for', () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const { result } = mounted();

    expect(result.current.isNamingAtEditable).toBe(false);

    act(() => result.current.setNamingAt(4));

    expect(result.current.settings.namingAt).toBe(16);
  });

  /*
   * docs/MOTION.md §6: the beamer has to be told, and told through the snapshot
   * so a window that is already showing something picks it up.
   */
  it('sends performance mode on to the beamer', () => {
    const { result } = mounted();

    act(() => result.current.setPerformanceMode(true));

    expect(result.current.settings.performanceMode).toBe(true);
    expect(tournamentStore.getState().tournament.performanceMode).toBe(true);
  });

  /*
   * The issue's third acceptance criterion. Both controls that write the
   * wording — this one and the one beside the field — read the same tournament,
   * so a change made in either is on screen everywhere on the next render.
   */
  it('switches the participant wording immediately', () => {
    const { result } = mounted();

    act(() => result.current.setParticipant('TEAM'));

    expect(result.current.settings.participantLabel).toBe('TEAM');
    expect(tournamentStore.getState().tournament.participantLabel).toBe('TEAM');
  });

  it('reads a default rather than throwing when the tournament is closed', () => {
    const { result } = mounted();

    act(() => closeDocument(tournamentStore));

    expect(result.current.name).toBe('');
    expect(result.current.isNamingAtEditable).toBe(false);
  });
});
