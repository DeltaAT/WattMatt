import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The net under a React tree (issue #30, docs/ARCHITECTURE.md §6).
 *
 * An exception thrown while rendering unmounts the whole tree by default: a
 * white window on the laptop, and a white rectangle on the projector in front
 * of fifty people. A boundary replaces that with a picture somebody chose.
 *
 * A class because React offers no hook for this — `componentDidCatch` and
 * `getDerivedStateFromError` exist only on classes. It is the one class
 * component in the codebase, and it stays generic: what to draw instead and
 * what to do about it are the caller's business, because the two windows
 * answer both questions completely differently.
 */

export interface ErrorBoundaryProps {
  /**
   * What to draw instead. `retry` clears the error and renders the children
   * again — worth offering wherever the cause may have passed.
   */
  fallback: (retry: () => void) => ReactNode;
  /**
   * Called once per failure, before the fallback is drawn.
   *
   * Where the log entry and the host's toast come from. It is called inside a
   * `try`: React is already unwinding, and a reporter that threw would take
   * the boundary down with it.
   */
  onError?: ((error: unknown, componentStack: string) => void) | undefined;
  /**
   * Clears a standing error whenever this value changes.
   *
   * The projector's recovery path. A failed scene stays failed — re-rendering
   * a tree that has just thrown only throws again — until the host stages
   * something else, at which point the beamer has to try again rather than
   * hold a neutral picture for the rest of the evening.
   */
  resetKey?: unknown;
  children: ReactNode;
}

/** A union rather than a boolean and an optional field (CLAUDE.md §6). */
type ErrorBoundaryState = { status: 'ok' } | { status: 'failed'; error: unknown };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { status: 'ok' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { status: 'failed', error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info.componentStack ?? '');
    } catch {
      // Reporting a failure must never become the second failure.
    }
  }

  /**
   * Compared against the *previous* props rather than remembered in state: the
   * failure itself is not a props change, so the first comparison after a throw
   * is `key === key` and nothing resets until the host actually changes
   * something.
   */
  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.status === 'failed' && previous.resetKey !== this.props.resetKey) {
      this.setState({ status: 'ok' });
    }
  }

  private readonly retry = (): void => {
    this.setState({ status: 'ok' });
  };

  override render(): ReactNode {
    if (this.state.status === 'failed') {
      return this.props.fallback(this.retry);
    }
    return this.props.children;
  }
}
