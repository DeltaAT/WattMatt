// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '@/ui/ErrorBoundary';

/**
 * The net under a React tree (issue #30).
 *
 * Every assertion here is about the one thing an unhandled render exception
 * costs during an event: the whole window, replaced by nothing.
 */

function Boom({ throws }: { throws: boolean }) {
  if (throws) {
    throw new Error('the scene could not be drawn');
  }
  return <p>the picture</p>;
}

/*
 * React writes every caught error to the console as well as handing it to the
 * boundary, by design and with no way to switch it off. Silencing it here keeps
 * the suite readable; it is restored afterwards so a real error still shows.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('an error boundary', () => {
  it('renders its children while nothing is wrong', () => {
    render(
      <ErrorBoundary fallback={() => <p>the fallback</p>}>
        <Boom throws={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('the picture')).toBeDefined();
  });

  /* The acceptance criterion, in its smallest form: never a white window. */
  it('draws the fallback instead of unmounting the tree', () => {
    render(
      <ErrorBoundary fallback={() => <p>the fallback</p>}>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(screen.getByText('the fallback')).toBeDefined();
    expect(screen.queryByText('the picture')).toBeNull();
  });

  it('hands the failure to the reporter', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={() => <p>the fallback</p>} onError={onError}>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('the scene could not be drawn');
  });

  it('passes the component stack on, because it says which scene threw', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={() => <p>the fallback</p>} onError={onError}>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(onError.mock.calls[0]?.[1]).toContain('Boom');
  });

  /*
   * A reporter that threw would take the boundary down with it, which is the
   * failure the boundary exists to prevent — and it would do so precisely when
   * something has already gone wrong.
   */
  it('still draws the fallback when the reporter itself throws', () => {
    render(
      <ErrorBoundary
        fallback={() => <p>the fallback</p>}
        onError={() => {
          throw new Error('the log is gone too');
        }}
      >
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(screen.getByText('the fallback')).toBeDefined();
  });

  /*
   * The host's way out. The store lives at module scope, so the tournament, the
   * undo stack and the pending autosave all survive a failed render — retrying
   * really is often enough, and it costs nothing that a reload would not.
   */
  it('renders the children again when the fallback asks to retry', () => {
    let failing = true;
    function Sometimes() {
      if (failing) {
        throw new Error('not yet');
      }
      return <p>the picture</p>;
    }

    render(
      <ErrorBoundary fallback={(retry) => <button onClick={retry}>retry</button>}>
        <Sometimes />
      </ErrorBoundary>,
    );
    expect(screen.getByText('retry')).toBeDefined();

    failing = false;
    fireEvent.click(screen.getByText('retry'));

    expect(screen.getByText('the picture')).toBeDefined();
  });

  /*
   * The projector's way out. A scene that threw will throw again on the next
   * snapshot, so the boundary holds; staging a different scene is the host's
   * signal that it is worth another try.
   */
  it('clears itself when the reset key changes', () => {
    const view = render(
      <ErrorBoundary resetKey="DRAW" fallback={() => <p>the fallback</p>}>
        <Boom throws />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the fallback')).toBeDefined();

    view.rerender(
      <ErrorBoundary resetKey="BLACKOUT" fallback={() => <p>the fallback</p>}>
        <Boom throws={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('the picture')).toBeDefined();
  });

  /*
   * Without this the boundary would re-render the broken tree on every
   * snapshot the host sends — sixty times a minute during a round, each one
   * throwing, each one writing a log entry.
   */
  it('holds the fallback while the reset key stays the same', () => {
    const view = render(
      <ErrorBoundary resetKey="DRAW" fallback={() => <p>the fallback</p>}>
        <Boom throws />
      </ErrorBoundary>,
    );

    view.rerender(
      <ErrorBoundary resetKey="DRAW" fallback={() => <p>the fallback</p>}>
        <Boom throws={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('the fallback')).toBeDefined();
    expect(screen.queryByText('the picture')).toBeNull();
  });

  it('reports each failure once rather than once per render', () => {
    const onError = vi.fn();
    const view = render(
      <ErrorBoundary resetKey="DRAW" fallback={() => <p>the fallback</p>} onError={onError}>
        <Boom throws />
      </ErrorBoundary>,
    );

    view.rerender(
      <ErrorBoundary resetKey="DRAW" fallback={() => <p>the fallback</p>} onError={onError}>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
