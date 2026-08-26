import { de } from '@/i18n';
import type { Problem, ProblemKind } from '@/store/problems';

/**
 * What the host is told when something failed that is not about a file
 * (issue #30, docs/ARCHITECTURE.md §6).
 *
 * Non-blocking by design: a stack in the corner, never a modal. The host is
 * mid-round with a room watching, and a dialog that has to be answered before
 * the next result can be entered would make a broken heartbeat more expensive
 * than the thing it is warning about (CLAUDE.md golden rule 3).
 *
 * File failures do **not** come through here. They have their own strip at the
 * top of the window, because they carry a way out — a backup to open, a place
 * to save — and because an autosave that has stopped working must not be
 * dismissible at all (`FileNotice`).
 *
 * One card per kind, with a repeat count. A broken sync fails on every commit,
 * and a host who has dismissed forty identical toasts during one round will
 * dismiss the forty-first without reading it.
 */
export function ProblemToasts({
  problems,
  onDismiss,
}: {
  problems: readonly Problem[];
  onDismiss: (kind: ProblemKind) => void;
}) {
  if (problems.length === 0) {
    return null;
  }

  return (
    <div
      // Over the panels rather than in the layout: a message that appeared
      // between two rounds must not move the button the host was about to
      // press. `pointer-events-none` on the stack and back on for each card,
      // so the gaps between them stay clickable.
      className="pointer-events-none absolute bottom-4 right-4 z-10 flex w-96 flex-col gap-2"
      role="region"
      aria-label={de.failure.regionLabel}
    >
      {problems.map((problem) => (
        <ProblemToast
          key={problem.kind}
          problem={problem}
          onDismiss={() => onDismiss(problem.kind)}
        />
      ))}
    </div>
  );
}

function ProblemToast({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  return (
    <div
      // `alert`, not `status`: every kind here is something that has stopped
      // working, and the host may be looking at the other screen.
      role="alert"
      data-problem={problem.kind}
      className="wm-toast pointer-events-auto flex items-start gap-3 rounded-wm-md border border-wm-lose bg-wm-lose-bg px-3 py-2"
    >
      <p className="flex-1 text-host-sm text-wm-text">{MESSAGE[problem.kind]}</p>

      {/*
        Only from the second time: a count on a single occurrence would read as
        a serial number and make the host look for the other ones.
      */}
      {problem.count > 1 ? (
        <span className="wm-tnum shrink-0 text-host-xs text-wm-text-muted">
          {de.failure.repeated({ n: problem.count })}
        </span>
      ) : null}

      <button
        type="button"
        className="h-6 shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-2 text-host-xs text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover"
        onClick={onDismiss}
      >
        {de.common.dismiss}
      </button>
    </div>
  );
}

/**
 * The German sentence for a kind.
 *
 * A total record rather than a `switch`: a `ProblemKind` added by a later issue
 * fails the typecheck here instead of reaching the host as a blank toast.
 */
const MESSAGE: Record<ProblemKind, string> = {
  unexpected: de.error.unexpected,
  beamerScene: de.error.beamerScene,
  beamerSync: de.error.beamerSync,
  beamerCommand: de.error.beamerCommand,
  beamerStatus: de.error.beamerStatus,
  sleepInhibitFailed: de.error.sleepInhibitFailed,
  sessionMarkerFailed: de.error.sessionMarkerFailed,
  logUnavailable: de.error.logUnavailable,
};
