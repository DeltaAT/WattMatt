// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_GROUP_NAME_LENGTH, type NamingEntry, type NamingState } from '@/domain/naming';
import { groupId } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { NamingPanel } from '@/windows/host/NamingPanel';

/**
 * The naming panel (issue #23).
 *
 * The rules are tested in `@/domain/naming`; what is checked here is the minute
 * the host actually spends in this panel — sixteen names, a room waiting, and
 * no hand on the mouse. So the assertions are about the keyboard: that Tab
 * reaches every field in numbered order, that Enter commits and moves on, and
 * that the two things which are *not* refusals — a duplicate name, a field the
 * host tabbed through — behave differently from the one that is.
 */

afterEach(cleanup);

/** `count` rows, of which the first `named` carry a name. */
function state(count: number, named = 0, overrides: Partial<NamingState> = {}): NamingState {
  const entries: NamingEntry[] = Array.from({ length: count }, (_unused, index) => ({
    groupId: groupId(index + 1),
    number: index + 1,
    name: index < named ? `Name ${index + 1}` : null,
    isDuplicate: false,
  }));

  return {
    entries,
    named,
    total: count,
    duplicates: 0,
    complete: named === count,
    ...overrides,
  };
}

function fields(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('[data-naming-input]')];
}

describe('the naming panel', () => {
  it('is absent while names are not being asked for', () => {
    const { container } = render(
      <NamingPanel state={null} participant="GROUP" onRename={vi.fn()} onShowOnBeamer={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('offers one field per remaining participant, in numbered order', () => {
    render(
      <NamingPanel
        state={state(16)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(fields()).toHaveLength(16);
    expect(fields().map((field) => field.getAttribute('data-naming-input'))).toEqual(
      Array.from({ length: 16 }, (_unused, index) => `grp_${index + 1}`),
    );
  });

  /*
   * The number is the identity of a participant for the whole event (§0) and
   * stays on the row beside the name, not only until one is entered.
   */
  it('keeps the number visible beside a name that has been entered', () => {
    render(
      <NamingPanel
        state={state(2, 2)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(document.querySelector('[data-naming-number="1"]')?.textContent).toBe('1');
    expect(document.querySelector('[data-naming-number="2"]')?.textContent).toBe('2');
    expect(fields()[0]?.value).toBe('Name 1');
  });

  it('reports the progress the issue asks for', () => {
    render(
      <NamingPanel
        state={state(16, 12)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(screen.getByText(de.naming.progress({ named: 12, total: 16 }))).toBeTruthy();
  });

  /*
   * Nothing focusable may sit between two name fields, or Tab costs the host a
   * keystroke per participant. jsdom does not implement Tab itself, so what is
   * asserted is the property that makes Tab work: the fields are consecutive in
   * the panel's tab order.
   */
  it('puts nothing focusable between one name and the next', () => {
    const { container } = render(
      <NamingPanel
        state={state(4)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const focusable = [
      ...container.querySelectorAll<HTMLElement>('input, button, select, textarea, a[href]'),
    ];
    const names = focusable.filter((element) => element.hasAttribute('data-naming-input'));
    const first = focusable.indexOf(names[0] as HTMLElement);

    expect(names).toHaveLength(4);
    expect(focusable.slice(first, first + 4)).toEqual(names);
  });

  it('commits a name when the field is left', () => {
    const onRename = vi.fn();
    render(
      <NamingPanel
        state={state(2)}
        participant="GROUP"
        onRename={onRename}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const first = fields()[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: 'Die Schnellen' } });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.blur(first);
    expect(onRename).toHaveBeenCalledWith(groupId(1), 'Die Schnellen');
  });

  it('commits on Enter and moves the keyboard to the next name', () => {
    const onRename = vi.fn();
    render(
      <NamingPanel
        state={state(3)}
        participant="GROUP"
        onRename={onRename}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const first = fields()[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: 'Die Schnellen' } });
    fireEvent.keyDown(first, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith(groupId(1), 'Die Schnellen');
    expect(document.activeElement).toBe(fields()[1]);
  });

  it('lets the keyboard go after the last name rather than trapping it', () => {
    render(
      <NamingPanel
        state={state(2)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const last = fields()[1] as HTMLInputElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Enter' });

    expect(document.activeElement).not.toBe(last);
  });

  /* The way out of a half-typed name, and the same key as everywhere else. */
  it('puts the stored name back on Escape without committing', () => {
    const onRename = vi.fn();
    render(
      <NamingPanel
        state={state(2, 2)}
        participant="GROUP"
        onRename={onRename}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const first = fields()[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: 'Die Falschen' } });
    fireEvent.keyDown(first, { key: 'Escape' });

    expect(first.value).toBe('Name 1');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('does not commit a field the host only tabbed through', () => {
    const onRename = vi.fn();
    render(
      <NamingPanel
        state={state(2, 2)}
        participant="GROUP"
        onRename={onRename}
        onShowOnBeamer={vi.fn()}
      />,
    );

    fireEvent.blur(fields()[0] as HTMLInputElement);
    expect(onRename).not.toHaveBeenCalled();
  });

  it('refuses an empty name, says why, and puts the old one back', () => {
    const onRename = vi.fn();
    render(
      <NamingPanel
        state={state(2, 2)}
        participant="GROUP"
        onRename={onRename}
        onShowOnBeamer={vi.fn()}
      />,
    );

    const first = fields()[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: '   ' } });
    expect(screen.getByText(de.naming.empty)).toBeTruthy();

    fireEvent.blur(first);
    expect(onRename).not.toHaveBeenCalled();
    expect(first.value).toBe('Name 1');
  });

  it('stops the host at 40 characters in the field itself', () => {
    render(
      <NamingPanel
        state={state(1)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(fields()[0]?.getAttribute('maxlength')).toBe(String(MAX_GROUP_NAME_LENGTH));
  });

  /* Two teams may genuinely share a name (§6): a warning, never a refusal. */
  it('warns about a duplicate on the row and keeps it', () => {
    const duplicated = state(2, 2);
    render(
      <NamingPanel
        state={{
          ...duplicated,
          entries: duplicated.entries.map((entry) => ({ ...entry, isDuplicate: true })),
          duplicates: 2,
        }}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(document.querySelectorAll('[data-naming-duplicate]')).toHaveLength(2);
    expect(screen.getByText(de.naming.duplicateCount({ n: 2 }))).toBeTruthy();
    expect(fields()[0]?.value).toBe('Name 1');
  });

  /* §6: the bracket cannot be drawn until every remaining group has a name. */
  it('says the Turnierbaum is still blocked while names are missing', () => {
    render(
      <NamingPanel
        state={state(16, 12)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(screen.getByText(de.naming.missing({ n: 4 }))).toBeTruthy();
    expect(document.querySelector('[data-naming-gate="complete"]')).toBeNull();
  });

  it('says the Turnierbaum can be drawn once every name is in', () => {
    render(
      <NamingPanel
        state={state(16, 16)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(screen.getByText(de.naming.complete)).toBeTruthy();
    expect(document.querySelector('[data-naming-gate="missing"]')).toBeNull();
  });

  it('labels every field in the wording this tournament uses', () => {
    render(
      <NamingPanel
        state={state(2)}
        participant="TEAM"
        onRename={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(
      screen.getAllByLabelText(
        de.naming.nameLabel({ participant: de.participant.TEAM.numbered({ n: 1 }) }),
      ),
    ).not.toHaveLength(0);
  });

  it('puts the holding picture on the beamer when the host asks', () => {
    const onShowOnBeamer = vi.fn();
    render(
      <NamingPanel
        state={state(2)}
        participant="GROUP"
        onRename={vi.fn()}
        onShowOnBeamer={onShowOnBeamer}
      />,
    );

    fireEvent.click(screen.getByText(de.naming.showOnBeamer));
    expect(onShowOnBeamer).toHaveBeenCalledTimes(1);
  });
});
