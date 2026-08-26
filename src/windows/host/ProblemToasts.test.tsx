// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { de } from '@/i18n';
import type { Problem, ProblemKind } from '@/store/problems';
import { ProblemToasts } from '@/windows/host/ProblemToasts';

/**
 * The host half of issue #30's acceptance criteria: *every user-facing error
 * message is German and actionable*, and it is non-blocking.
 *
 * The wording itself is the locale file's business, and `de-AT.test.ts` already
 * enforces that every `error.*` entry says what happened **and** what to do
 * next. What is asserted here is that the right sentence reaches the right
 * toast, that the host can always get rid of one, and that nothing English or
 * technical leaks onto the screen.
 */

const ALL_KINDS: ProblemKind[] = [
  'unexpected',
  'beamerScene',
  'beamerSync',
  'beamerCommand',
  'beamerStatus',
  'sleepInhibitFailed',
  'sessionMarkerFailed',
  'logUnavailable',
];

const MESSAGES: Record<ProblemKind, string> = {
  unexpected: de.error.unexpected,
  beamerScene: de.error.beamerScene,
  beamerSync: de.error.beamerSync,
  beamerCommand: de.error.beamerCommand,
  beamerStatus: de.error.beamerStatus,
  sleepInhibitFailed: de.error.sleepInhibitFailed,
  sessionMarkerFailed: de.error.sessionMarkerFailed,
  logUnavailable: de.error.logUnavailable,
};

function problem(kind: ProblemKind, count = 1): Problem {
  return { kind, count, at: 0 };
}

function show(problems: readonly Problem[], onDismiss: (kind: ProblemKind) => void = () => {}) {
  return render(<ProblemToasts problems={problems} onDismiss={onDismiss} />);
}

afterEach(cleanup);

describe('the problem toasts', () => {
  it('draw nothing at all when nothing is wrong', () => {
    const { container } = show([]);
    expect(container.innerHTML).toBe('');
  });

  /*
   * A kind with no sentence would reach the host as a blank card. The record in
   * the component makes that a typecheck failure rather than a live one, and
   * this walks every kind to prove the record is actually wired up.
   */
  it('carry a German sentence for every kind there is', () => {
    for (const kind of ALL_KINDS) {
      const view = show([problem(kind)]);
      expect(screen.getByText(MESSAGES[kind]), kind).toBeDefined();
      view.unmount();
    }
  });

  it('name the failure rather than describing failure in general', () => {
    show([problem('beamerScene')]);

    expect(screen.getByText(de.error.beamerScene)).toBeDefined();
    expect(screen.queryByText(de.error.unexpected)).toBeNull();
  });

  it('offer a way to get rid of each one', () => {
    const onDismiss = vi.fn();
    show([problem('beamerSync')], onDismiss);

    fireEvent.click(screen.getByText(de.common.dismiss));

    expect(onDismiss).toHaveBeenCalledWith('beamerSync');
  });

  /*
   * A count on a single occurrence would read as a serial number and send the
   * host looking for the other ones.
   */
  it('show no count the first time something goes wrong', () => {
    show([problem('beamerSync')]);
    expect(screen.queryByText(de.failure.repeated({ n: 1 }))).toBeNull();
  });

  it('show how often it has happened from the second time on', () => {
    show([problem('beamerSync', 12)]);
    expect(screen.getByText(de.failure.repeated({ n: 12 }))).toBeDefined();
  });

  it('draw one card per kind, in the order they were given', () => {
    const { container } = show([problem('unexpected'), problem('beamerSync')]);
    const kinds = [...container.querySelectorAll('[data-problem]')].map((card) =>
      card.getAttribute('data-problem'),
    );

    expect(kinds).toEqual(['unexpected', 'beamerSync']);
  });

  /*
   * The host is mid-round with a room watching. A dialog that had to be
   * answered before the next result could be entered would make a broken
   * heartbeat more expensive than the thing it warns about (golden rule 3).
   */
  it('are an alert region and never a modal', () => {
    const { container } = show([problem('unexpected')]);

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[aria-modal]')).toBeNull();
  });

  it('name the stack, for anyone reading the window rather than looking at it', () => {
    show([problem('unexpected')]);
    expect(screen.getByRole('region', { name: de.failure.regionLabel })).toBeDefined();
  });

  /*
   * The whole point of the strip. The host has to be able to click the button
   * behind a toast without dismissing the toast first.
   */
  it('let clicks through the gaps between the cards', () => {
    const { container } = show([problem('unexpected')]);
    const stack = container.firstElementChild;

    expect(stack?.className).toContain('pointer-events-none');
    expect(container.querySelector('[data-problem]')?.className).toContain('pointer-events-auto');
  });
});
