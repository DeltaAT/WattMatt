import { FINAL_PHASE_SIZE } from '@/domain/draw';
import type { PhaseBlocker, PhaseStep } from '@/domain/progression';
import type { Phase, RoundTrack } from '@/domain/types';
import { de } from '@/i18n';

/**
 * Where the tournament stands and the one button that moves it on
 * (issue #22, docs/TOURNAMENT-RULES.md §1).
 *
 * At the top of the host window, above the round, because it answers the
 * question the host is asked out loud between rounds — "und was passiert
 * jetzt?" — and because the answer has to be readable before the decision is
 * made rather than after.
 *
 * **One button, and it names its destination.** Not *Weiter*: the host says the
 * phase out loud to the room a second before they press it, and a button that
 * only says "next" makes them work out what next is while fifty people wait.
 * When it is greyed out the reason is on the control itself and repeated
 * underneath, for the pointer and for the screen reader alike — the same shape
 * the round and pre-start panels use.
 *
 * Presentational. Every decision comes in as a callback from `usePhase`, which
 * is what lets the whole panel be rendered in a test without a store.
 */
export function PhasePanel({
  phase,
  step,
  track = 'MAIN',
  onAdvance,
}: {
  phase: Phase;
  /** Null once the phase moves on some other way — `SETUP`, and #23 onwards. */
  step: PhaseStep | null;
  /**
   * Which of the two tournaments this panel steps (issue #91, §10).
   *
   * Both run the same pipeline, so both put the same phase names and the same
   * button in front of the host — routinely at the same time and several rounds
   * apart. The panel therefore says which tournament it is stepping, because
   * *Ausscheidungsrunden* on its own is true of both.
   *
   * Defaulted, so the main field's panel is exactly what it was.
   */
  track?: RoundTrack;
  onAdvance: () => void;
}) {
  const reason = step?.blockers.map((blocker) => blockerText(blocker, step.field))[0];
  const label = step === null ? null : de.phase.advance({ phase: de.phase.name[step.to] });

  return (
    <section
      className="flex flex-col gap-2"
      aria-label={track === 'MAIN' ? de.phase.sectionLabel : de.consolation.phaseLabel}
      data-phase-track={track}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold" data-phase={phase}>
          {de.phase.name[phase]}
        </h2>

        {/*
          Beside the phase rather than instead of it: the host reads the phase
          they are in and the tournament it belongs to as one line.
        */}
        {track === 'MAIN' ? null : (
          <span className="text-host-sm font-semibold text-wm-accent" data-phase-track-label="">
            {de.consolation.label}
          </span>
        )}

        {step === null ? null : (
          <span className="wm-tnum text-host-sm text-wm-text" data-phase-field="">
            {de.phase.field({ n: step.field })}
          </span>
        )}

        <div className="ml-auto">
          {step === null || label === null ? null : (
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onAdvance}
              disabled={!step.canAdvance}
              // The reason is on the control the click was aimed at, for both
              // the pointer and the screen reader.
              title={reason === undefined ? undefined : de.phase.blocked({ reason })}
              aria-label={reason === undefined ? label : de.phase.blocked({ reason })}
              data-phase-action="advance"
            >
              {label}
            </button>
          )}
        </div>
      </header>

      {step === null ? (
        <p className="text-host-sm text-wm-text-muted" data-phase-none="">
          {de.phase.noStep}
        </p>
      ) : (
        <>
          <p className="text-host-sm text-wm-text-muted" data-phase-outlook="">
            {de.phase.outlook({ phase: de.phase.name[step.to], n: step.field })}
          </p>
          {reason === undefined ? null : (
            <p className="text-host-sm text-wm-text-muted" data-phase-reason="">
              {reason}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The German for a phase blocker. It names the numbers the host is weighing. */
function blockerText(blocker: PhaseBlocker, field: number): string {
  switch (blocker) {
    case 'ROUND_NOT_DRAWN':
      return de.phase.roundNotDrawn;
    case 'ROUND_OPEN':
      return de.phase.roundOpen;
    case 'REPECHAGE_OPEN':
      return de.phase.repechageOpen;
    case 'FIELD_TOO_LARGE':
      return de.phase.fieldTooLarge({ n: field, final: FINAL_PHASE_SIZE });
  }
}

/** 40 px: a high-frequency host control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';
