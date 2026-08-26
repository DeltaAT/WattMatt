// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { de } from '@/i18n';
import { HostErrorFallback } from '@/windows/host/HostErrorFallback';

/**
 * What fills the host window when its tree could not be drawn (issue #30).
 *
 * The screen a host reads while the room waits, so the assertions are about
 * exactly that: German, a way forward, and nothing on it that a host cannot act
 * on.
 */

afterEach(cleanup);

describe('the host error screen', () => {
  it('says what happened and what to do about it, in German', () => {
    render(<HostErrorFallback onRetry={() => {}} onOpenLog={() => {}} />);

    expect(screen.getByText(de.failure.title)).toBeDefined();
    expect(screen.getByText(de.error.hostCrashed)).toBeDefined();
  });

  /*
   * A stack trace is for the log. On this screen it is a wall of English the
   * host cannot act on, in front of a room that is waiting for them.
   */
  it('shows no stack trace and nothing English', () => {
    render(<HostErrorFallback onRetry={() => {}} onOpenLog={() => {}} />);

    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain('Error');
    // A stack frame: `at Component (…/BracketScene.tsx:41:9)`.
    expect(shown).not.toMatch(/\bat \S+:\d+/u);
    expect(shown).not.toMatch(/\.(tsx|ts|js)\b/u);
  });

  it('retries without discarding the tournament', () => {
    const onRetry = vi.fn();
    render(<HostErrorFallback onRetry={onRetry} onOpenLog={() => {}} />);

    fireEvent.click(screen.getByText(de.failure.retry));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers the log, because the host will be asked afterwards', () => {
    const onOpenLog = vi.fn();
    render(<HostErrorFallback onRetry={() => {}} onOpenLog={onOpenLog} />);

    fireEvent.click(screen.getByText(de.log.open));

    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  /*
   * Two buttons and no third. A reload would discard whatever the autosave has
   * not written in the last half second, and putting one beside a retry offers
   * a host under pressure a way to lose the result they have just entered.
   */
  it('offers exactly the two ways forward that cost nothing', () => {
    render(<HostErrorFallback onRetry={() => {}} onOpenLog={() => {}} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('announces itself, because the host may be looking at the projector', () => {
    const { container } = render(<HostErrorFallback onRetry={() => {}} onOpenLog={() => {}} />);

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
