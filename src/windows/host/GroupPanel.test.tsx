// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addGroups } from '@/domain/groups';
import type { GroupId } from '@/domain/ids';
import { group, groupId, midTournament, tournament } from '@/domain/testFixtures';
import type { Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { GroupPanel } from '@/windows/host/GroupPanel';

/**
 * The host's group panel (issue #14).
 *
 * The rules are tested in `@/domain/groups`; what is checked here is what the
 * host actually experiences — that the keyboard alone fills a field of forty,
 * that a chip nobody may delete says why, and that a late entry is warned about
 * rather than refused.
 */

afterEach(cleanup);

const FIVE = addGroups(tournament(), 5).groups;

function handlers() {
  return {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onParticipantChange: vi.fn(),
    onShowOnBeamer: vi.fn(),
  };
}

function setup({
  groups = FIVE,
  participant = 'GROUP' as ParticipantLabel,
  hasStarted = false,
  canRemove = () => true,
}: {
  groups?: readonly Group[];
  participant?: ParticipantLabel;
  hasStarted?: boolean;
  canRemove?: (groupId: GroupId) => boolean;
} = {}) {
  const spies = handlers();
  render(
    <GroupPanel
      groups={groups}
      participant={participant}
      hasStarted={hasStarted}
      canRemove={canRemove}
      {...spies}
    />,
  );
  return spies;
}

/** The chip of one participant. */
function chip(id: GroupId): HTMLElement {
  const element = document.querySelector(`[data-group-id="${id}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no chip for ${id}`);
  }
  return element;
}

const button = (action: string): HTMLElement => {
  const element = document.querySelector(`[data-group-action="${action}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no control for ${action}`);
  }
  return element;
};

const clickIn = (parent: HTMLElement, action: string) => {
  const element = parent.querySelector(`[data-group-action="${action}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no control for ${action}`);
  }
  fireEvent.click(element);
};

describe('adding participants', () => {
  it('adds one on the `+`', () => {
    const spies = setup();

    fireEvent.click(button('add'));

    expect(spies.onAdd).toHaveBeenCalledWith(1);
  });

  /*
   * The acceptance criterion of issue #14: 40 participants in under fifteen
   * seconds with the keyboard. Both keys reach the same action, so the host
   * never has to look at the screen to find a button.
   */
  it.each(['+', 'Enter'])('adds one when the host presses %s', (key) => {
    const spies = setup();

    fireEvent.keyDown(document.body, { key });

    expect(spies.onAdd).toHaveBeenCalledWith(1);
  });

  /* Otherwise the same press adds one here and clicks a button there, and the
   * host discovers it at 41 chips. */
  it('leaves the key alone while something has focus', () => {
    const spies = setup();

    fireEvent.keyDown(button('add'), { key: 'Enter' });

    expect(spies.onAdd).not.toHaveBeenCalled();
  });

  it('leaves the key alone with a modifier held', () => {
    const spies = setup();

    fireEvent.keyDown(document.body, { key: '+', ctrlKey: true });

    expect(spies.onAdd).not.toHaveBeenCalled();
  });

  it('adds a whole field from the bulk input', () => {
    const spies = setup();

    fireEvent.change(document.querySelector('[data-group-input="count"]') as HTMLInputElement, {
      target: { value: '40' },
    });
    fireEvent.click(button('bulk'));

    expect(spies.onAdd).toHaveBeenCalledWith(40);
  });

  it('refuses a bulk count that is not a number of participants', () => {
    setup();

    const input = document.querySelector('[data-group-input="count"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });

    expect(button('bulk')).toHaveProperty('disabled', true);
  });
});

describe('the grid', () => {
  it('shows every participant with the number they were given', () => {
    setup();

    expect(document.querySelectorAll('[data-group-id]')).toHaveLength(5);
    expect(chip(groupId(3)).textContent).toContain('3');
  });

  it('counts them, live', () => {
    setup();

    expect(button('beamer').parentElement?.textContent).toContain(
      de.participant.GROUP.count({ n: 5 }),
    );
  });

  it('says so when nobody has been entered yet', () => {
    setup({ groups: [] });

    expect(screen.getByText(de.participant.GROUP.empty)).toBeTruthy();
  });

  /* docs/TOURNAMENT-RULES.md §9 case 4: a tournament cannot start under two. */
  it('warns while there are fewer than two participants', () => {
    setup({ groups: [group(1)] });

    expect(screen.getByText(de.participant.GROUP.tooFew)).toBeTruthy();
  });

  it('marks a participant who is out', () => {
    setup({ groups: [group(1, { status: 'ELIMINATED' }), group(2)] });

    expect(chip(groupId(1)).getAttribute('data-group-status')).toBe('ELIMINATED');
    // The word as well as the colour: a host reading the grid at a glance
    // (docs/STYLEGUIDE.md §1).
    expect(chip(groupId(1)).textContent).toContain(de.outcome.eliminated);
  });

  it('sends the beamer to the group overview', () => {
    const spies = setup();

    fireEvent.click(button('beamer'));

    expect(spies.onShowOnBeamer).toHaveBeenCalled();
  });
});

describe('removing a participant', () => {
  it('removes the one whose chip was clicked', () => {
    const spies = setup();

    clickIn(chip(groupId(3)), 'remove');

    expect(spies.onRemove).toHaveBeenCalledWith(groupId(3));
  });

  /*
   * Greyed out with a reason rather than hidden: a control that disappears
   * leaves the host looking for it, while one that says why answers the
   * question (`isRemovable` in `@/domain/groups`).
   */
  it('disables the control for a participant who has already been drawn', () => {
    setup({ groups: midTournament().groups, canRemove: () => false });

    const remove = chip(groupId(1)).querySelector('[data-group-action="remove"]');

    expect(remove).toHaveProperty('disabled', true);
    expect(remove?.getAttribute('title')).toBe(de.participant.GROUP.drawn);
  });
});

describe('the wording of a tournament', () => {
  it.each([
    ['TEAM' as const, 'Team 3'],
    ['PLAYER' as const, 'Spieler 3'],
  ])('calls a participant what %s means', (participant, expected) => {
    setup({ participant });

    expect(chip(groupId(3)).textContent).toContain(expected);
  });

  it('offers all three wordings and reports the one the host picks', () => {
    const spies = setup();

    const select = document.querySelector('[data-group-input="participant"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'TEAM' } });

    expect([...select.options].map((option) => option.value)).toEqual(['GROUP', 'TEAM', 'PLAYER']);
    expect(spies.onParticipantChange).toHaveBeenCalledWith('TEAM');
  });

  it('renames every control with it', () => {
    setup({ participant: 'TEAM' });

    expect(screen.getByText(de.participant.TEAM.bulkAdd)).toBeTruthy();
    expect(button('add').getAttribute('aria-label')).toBe(de.participant.TEAM.add);
  });
});

/**
 * "Groups can still be added before the first draw; afterwards the host is
 * warned" (issue #14). A warning, not a refusal — the host is in control
 * (CLAUDE.md golden rule 3).
 */
describe('a participant who turns up after the draw', () => {
  const dialog = () => document.querySelector('[data-group-dialog="afterDraw"]');

  it('is not added until the host has been told what it means', () => {
    const spies = setup({ hasStarted: true });

    fireEvent.click(button('add'));

    expect(spies.onAdd).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain(de.participant.GROUP.afterDrawBody);
  });

  it('is added once the host confirms', () => {
    const spies = setup({ hasStarted: true });
    fireEvent.click(button('add'));

    fireEvent.click(button('confirmAdd'));

    expect(spies.onAdd).toHaveBeenCalledWith(1);
    expect(dialog()).toBeNull();
  });

  it('carries the count the host asked for through the warning', () => {
    const spies = setup({ hasStarted: true });
    fireEvent.change(document.querySelector('[data-group-input="count"]') as HTMLInputElement, {
      target: { value: '3' },
    });
    fireEvent.click(button('bulk'));

    fireEvent.click(button('confirmAdd'));

    expect(spies.onAdd).toHaveBeenCalledWith(3);
  });

  it('adds nobody when the host thinks better of it', () => {
    const spies = setup({ hasStarted: true });
    fireEvent.click(button('add'));

    fireEvent.click(button('cancelAdd'));

    expect(spies.onAdd).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });
});
