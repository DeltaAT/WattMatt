// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { group, groupId, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useNaming, type NamingHandle } from '@/windows/host/useNaming';

/**
 * The wire between the naming panel and the store (issue #23).
 *
 * The store is the real one: what is being checked is that a name reaches it,
 * that the list redraws when it does, and that the panel disappears and
 * reappears with the field rather than with the phase — which is the answer
 * docs/OPEN-QUESTIONS.md #63 gives.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** `count` participants, all still in. */
function field(count: number, overrides: Partial<Tournament> = {}): Tournament {
  return tournament({
    name: 'Sommerturnier',
    groups: Array.from({ length: count }, (_unused, index) => group(index + 1)),
    nextGroupNumber: count + 1,
    ...overrides,
  });
}

function open(document: Tournament): void {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, document, PATH);
}

beforeEach(() => open(field(4, { phase: 'NAMING' })));

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<NamingHandle, void>(() => useNaming());

describe('the naming handle', () => {
  it('offers a row for every participant still in', () => {
    const { result } = mounted();

    expect(result.current.isActive).toBe(true);
    expect(result.current.state?.total).toBe(4);
    expect(result.current.state?.named).toBe(0);
  });

  it('writes a name through the store and redraws with it', () => {
    const { result } = mounted();

    act(() => result.current.rename(groupId(2), 'Die Schnellen'));

    expect(result.current.state?.entries[1]?.name).toBe('Die Schnellen');
    expect(tournamentStore.getState().document?.groups[1]?.name).toBe('Die Schnellen');
    expect(result.current.state?.named).toBe(1);
  });

  /* Golden rule 4: the projector must never be a decision behind the laptop. */
  it('sends the name on to the beamer projection', () => {
    const { result } = mounted();

    act(() => result.current.rename(groupId(1), 'Die Schnellen'));

    expect(tournamentStore.getState().tournament.groups[0]?.name).toBe('Die Schnellen');
  });

  /*
   * The panel follows the field, not the phase (docs/OPEN-QUESTIONS.md #63): a
   * host who moved the threshold up is asking to type names during the setup
   * they are sitting in.
   */
  it('is closed while the field is still larger than the threshold', () => {
    open(field(20, { phase: 'QUALIFYING' }));
    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it('is open during setup when the host has raised the threshold', () => {
    const many = field(20, { phase: 'SETUP' });
    open({ ...many, settings: { ...many.settings, namingAt: 32 } });
    const { result } = mounted();

    expect(result.current.isActive).toBe(true);
    expect(result.current.state?.total).toBe(20);
  });

  it('stages the holding picture and takes manual control of the beamer', () => {
    const { result } = mounted();

    act(() => result.current.showOnBeamer());

    expect(tournamentStore.getState().scene).toEqual({ id: 'NAMING' });
    expect(tournamentStore.getState().autoFollow).toBe(false);
  });

  it('reads nothing with no tournament open', () => {
    closeDocument(tournamentStore);
    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.state).toBeNull();
  });
});
