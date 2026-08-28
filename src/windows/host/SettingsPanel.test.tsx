// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/domain/factory';
import type { ParticipantLabel, Settings } from '@/domain/types';
import { de } from '@/i18n';
import { SettingsPanel } from '@/windows/host/SettingsPanel';

/**
 * The settings panel (issue #15).
 *
 * The rules are tested in `@/domain/settings`; what is checked here is what the
 * host actually experiences — that a rename reaches the store only once, that a
 * value the domain would refuse puts the old one back rather than leaving a
 * number on screen that was never committed, and that a locked field says why.
 */

afterEach(cleanup);

function handlers() {
  return {
    onRename: vi.fn(),
    onParticipantChange: vi.fn(),
    onNamingAtChange: vi.fn(),
    onPerformanceModeChange: vi.fn(),
    onTableAssignmentOrderChange: vi.fn(),
  };
}

function setup({
  name = 'Sommerturnier',
  settings = DEFAULT_SETTINGS,
  isNamingAtEditable = true,
}: { name?: string; settings?: Settings; isNamingAtEditable?: boolean } = {}) {
  const spies = handlers();
  render(
    <SettingsPanel
      name={name}
      settings={settings}
      rngSeed="8f3c1a7e"
      isNamingAtEditable={isNamingAtEditable}
      {...spies}
    />,
  );
  return spies;
}

const nameField = () => screen.getByLabelText(de.settings.tournamentName) as HTMLInputElement;
const namingAtField = () => screen.getByLabelText(de.settings.namingAt) as HTMLInputElement;
const participantField = () =>
  screen.getByLabelText(de.settings.participantLabel) as HTMLSelectElement;
const performanceToggle = () =>
  screen.getByRole('checkbox', { name: de.settings.performanceMode }) as HTMLInputElement;
const orderRadio = (order: 'ASCENDING' | 'DESCENDING') =>
  screen.getByRole('radio', {
    name: de.settings.tableAssignmentOrderOption[order],
  }) as HTMLInputElement;

describe('the tournament name', () => {
  it('shows the name the tournament has', () => {
    setup({ name: 'Vereinsturnier 2026' });

    expect(nameField().value).toBe('Vereinsturnier 2026');
  });

  /* One commit per rename, not one per keystroke: an undo stack full of
   * fragments of a word is one the host has to press once per letter. */
  it('commits once, on blur', () => {
    const spies = setup();

    fireEvent.change(nameField(), { target: { value: 'Herbstturnier' } });
    expect(spies.onRename).not.toHaveBeenCalled();

    fireEvent.blur(nameField());
    expect(spies.onRename).toHaveBeenCalledTimes(1);
    expect(spies.onRename).toHaveBeenCalledWith('Herbstturnier');
  });

  it('commits on Enter as well, so the host never reaches for the mouse', () => {
    const spies = setup();

    fireEvent.change(nameField(), { target: { value: 'Herbstturnier' } });
    fireEvent.keyDown(nameField(), { key: 'Enter' });
    fireEvent.blur(nameField());

    expect(spies.onRename).toHaveBeenCalledTimes(1);
    expect(spies.onRename).toHaveBeenCalledWith('Herbstturnier');
  });

  /* The domain refuses an empty name, so the field must not leave one on
   * screen: what the host reads has to be what the tournament says. */
  it('puts the old name back rather than committing an empty one', () => {
    const spies = setup({ name: 'Sommerturnier' });

    fireEvent.change(nameField(), { target: { value: '   ' } });
    fireEvent.blur(nameField());

    expect(spies.onRename).not.toHaveBeenCalled();
    expect(nameField().value).toBe('Sommerturnier');
  });

  it('abandons a half-typed rename on Escape', () => {
    const spies = setup({ name: 'Sommerturnier' });

    fireEvent.change(nameField(), { target: { value: 'Herbst' } });
    fireEvent.keyDown(nameField(), { key: 'Escape' });
    fireEvent.blur(nameField());

    expect(spies.onRename).not.toHaveBeenCalled();
    expect(nameField().value).toBe('Sommerturnier');
  });
});

describe('the naming threshold', () => {
  it('commits a field size the domain accepts', () => {
    const spies = setup();

    fireEvent.change(namingAtField(), { target: { value: '8' } });
    fireEvent.blur(namingAtField());

    expect(spies.onNamingAtChange).toHaveBeenCalledTimes(1);
    expect(spies.onNamingAtChange).toHaveBeenCalledWith(8);
  });

  it.each(['1', '0', '', 'acht'])('puts the old threshold back for %j', (typed) => {
    const spies = setup();

    fireEvent.change(namingAtField(), { target: { value: typed } });
    fireEvent.blur(namingAtField());

    expect(spies.onNamingAtChange).not.toHaveBeenCalled();
    expect(namingAtField().value).toBe(String(DEFAULT_SETTINGS.namingAt));
  });

  /* Greyed out with the reason beside it rather than removed: a control that
   * disappears leaves the host looking for it. */
  it('is disabled and says why once names have been asked for', () => {
    setup({ isNamingAtEditable: false });

    expect(namingAtField().disabled).toBe(true);
    expect(screen.getByText(de.settings.namingAtLocked)).not.toBeNull();
  });

  it('explains what it does while it is still editable', () => {
    setup();

    expect(screen.getByText(de.settings.namingAtHint)).not.toBeNull();
    expect(screen.queryByText(de.settings.namingAtLocked)).toBeNull();
  });
});

describe('performance mode', () => {
  /* docs/MOTION.md §6: the host reaches for this while the projector is
   * stuttering, so no phase may lock it. */
  it('toggles both ways', () => {
    const spies = setup();

    fireEvent.click(performanceToggle());

    expect(spies.onPerformanceModeChange).toHaveBeenCalledTimes(1);
    expect(spies.onPerformanceModeChange).toHaveBeenCalledWith(true);
  });

  it('shows the mode the tournament is in', () => {
    setup({ settings: { ...DEFAULT_SETTINGS, performanceMode: true } });

    expect(performanceToggle().checked).toBe(true);
  });
});

describe('the draw seed', () => {
  /* CLAUDE.md golden rule 7: a draw has to be defensible afterwards, and a
   * number nobody can read is a number nobody can check. */
  it('is on screen and is not an input', () => {
    setup();

    expect(screen.getByText('8f3c1a7e')).not.toBeNull();
    expect(screen.queryByDisplayValue('8f3c1a7e')).toBeNull();
  });
});

describe('the participant wording', () => {
  it.each<[ParticipantLabel, string]>([
    ['GROUP', de.participant.GROUP.many],
    ['TEAM', de.participant.TEAM.many],
    ['PLAYER', de.participant.PLAYER.many],
  ])('shows %s as %s, in the wording this tournament uses', (participantLabel, word) => {
    setup({ settings: { ...DEFAULT_SETTINGS, participantLabel } });

    const selected = participantField().selectedOptions[0];

    expect(participantField().value).toBe(participantLabel);
    expect(selected?.textContent).toBe(word);
  });

  it('reports the choice the host made', () => {
    const spies = setup();

    fireEvent.change(participantField(), { target: { value: 'TEAM' } });

    expect(spies.onParticipantChange).toHaveBeenCalledTimes(1);
    expect(spies.onParticipantChange).toHaveBeenCalledWith('TEAM');
  });
});

/**
 * Which end of the table list gets filled first (issue #101).
 *
 * Two radios rather than a checkbox, because both directions are ordinary
 * choices about a room and neither is the "on" of the other. Never disabled at
 * any phase: it decides only what the *next* assignment reaches for, so a host
 * who has just carried two more tables into the far end of the hall may flip it
 * mid-round.
 */
describe('the table assignment direction', () => {
  it('shows the direction the tournament is set to', () => {
    setup({ settings: { ...DEFAULT_SETTINGS, tableAssignmentOrder: 'DESCENDING' } });

    expect(orderRadio('DESCENDING').checked).toBe(true);
    expect(orderRadio('ASCENDING').checked).toBe(false);
  });

  it('starts out filling from the first table', () => {
    setup();

    expect(orderRadio('ASCENDING').checked).toBe(true);
  });

  it('reports the direction the host chose', () => {
    const spies = setup();

    fireEvent.click(orderRadio('DESCENDING'));

    expect(spies.onTableAssignmentOrderChange).toHaveBeenCalledTimes(1);
    expect(spies.onTableAssignmentOrderChange).toHaveBeenCalledWith('DESCENDING');
  });

  /* Mid-tournament is exactly when a host reconfigures a room, and this is one
   * of the settings that is never locked (`@/domain/settings`). */
  it('is offered whatever the naming threshold is doing', () => {
    setup({ isNamingAtEditable: false });

    expect(orderRadio('ASCENDING').disabled).toBe(false);
    expect(orderRadio('DESCENDING').disabled).toBe(false);
  });

  /* The hint says what the setting does *not* do, which is the half a host
   * needs before touching it during a live round. */
  it('says that running matches are left alone', () => {
    setup();

    expect(screen.getByText(de.settings.tableAssignmentOrderHint)).not.toBeNull();
  });
});
