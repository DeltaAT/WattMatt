// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FINAL_PHASE_SIZE } from '@/domain/draw';
import type { PhaseStep } from '@/domain/progression';
import { de } from '@/i18n';
import { PhasePanel } from '@/windows/host/PhasePanel';

/**
 * The phase panel (issue #22).
 *
 * The rules are tested in `@/domain/progression`; what is checked here is what the
 * host experiences — the one control that moves the evening on names where it
 * is going, is greyed out with the reason on it when it cannot, and is the only
 * thing on the screen that changes the phase.
 */

afterEach(cleanup);

function step(overrides: Partial<PhaseStep> = {}): PhaseStep {
  return {
    from: 'QUALIFYING',
    to: 'REPECHAGE',
    field: 20,
    blockers: [],
    canAdvance: true,
    ...overrides,
  };
}

describe('the phase panel', () => {
  it('names the phase the tournament is in and how many are still in it', () => {
    render(<PhasePanel phase="QUALIFYING" step={step()} onAdvance={vi.fn()} />);

    expect(screen.getByText(de.phase.name.QUALIFYING)).toBeTruthy();
    expect(screen.getByText(de.phase.field({ n: 20 }))).toBeTruthy();
  });

  /*
   * The destination is on the button rather than a bare "Weiter": the host says
   * the phase out loud to the room a second before they press it.
   */
  it('names the phase the step leads to on the button', () => {
    render(<PhasePanel phase="QUALIFYING" step={step()} onAdvance={vi.fn()} />);

    const button = screen.getByText(de.phase.advance({ phase: de.phase.name.REPECHAGE }));
    expect(button).toBeTruthy();
    expect(button.getAttribute('disabled')).toBeNull();
  });

  it('advances only when the host presses it', () => {
    const onAdvance = vi.fn();
    render(<PhasePanel phase="QUALIFYING" step={step()} onAdvance={onAdvance} />);

    expect(onAdvance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(de.phase.advance({ phase: de.phase.name.REPECHAGE })));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  /*
   * A greyed-out control with no reason on it is a control the host assumes is
   * broken. The reason goes on the button — for the pointer and the screen
   * reader — and again underneath, where it can be read without hovering.
   */
  it('says in German why it is doing nothing', () => {
    render(
      <PhasePanel
        phase="ELIMINATION"
        step={step({
          from: 'ELIMINATION',
          to: 'NAMING',
          field: 32,
          blockers: ['FIELD_TOO_LARGE'],
          canAdvance: false,
        })}
        onAdvance={vi.fn()}
      />,
    );

    const reason = de.phase.fieldTooLarge({ n: 32, final: FINAL_PHASE_SIZE });
    const button = screen.getByRole('button', { name: de.phase.blocked({ reason }) });

    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it.each([
    ['ROUND_NOT_DRAWN', de.phase.roundNotDrawn],
    ['ROUND_OPEN', de.phase.roundOpen],
    ['REPECHAGE_OPEN', de.phase.repechageOpen],
  ] as const)('explains %s', (blocker, text) => {
    render(
      <PhasePanel
        phase="QUALIFYING"
        step={step({ blockers: [blocker], canAdvance: false })}
        onAdvance={vi.fn()}
      />,
    );

    expect(screen.getByText(text)).toBeTruthy();
  });

  /*
   * `NAMING` onwards belongs to issues #23, #24 and #27. Until then the panel
   * says there is nothing to press rather than offering a button that would
   * produce a phase with nothing in it.
   */
  it('offers no button where a later issue owns the transition', () => {
    render(<PhasePanel phase="NAMING" step={null} onAdvance={vi.fn()} />);

    expect(screen.getByText(de.phase.noStep)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
