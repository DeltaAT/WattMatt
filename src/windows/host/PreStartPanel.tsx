import type { PreStartBlocker, PreStartReport } from '@/domain/start';
import type { ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';

/**
 * The gate between setup and a running tournament (issue #15).
 *
 * Three things, in the order a host reads them: what is missing, what round 1
 * will look like, and the button. Nothing here is a dialog — the checks are on
 * screen the whole time the host is setting up, so a problem is something they
 * fix while carrying chairs rather than something they discover by clicking a
 * disabled button.
 *
 * Every failed check says what to do about it, and the button carries the first
 * reason itself: a control that is greyed out with the explanation somewhere
 * else on the screen is one the host clicks again.
 *
 * Presentational. The report comes from `@/domain/start`, so the panel and the
 * draw engine (#16) cannot disagree about what "ready" means.
 */
export function PreStartPanel({
  report,
  participant,
  onStart,
}: {
  report: PreStartReport;
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  onStart: () => void;
}) {
  const reasons = report.blockers.map((blocker) => blockerText(blocker, participant));

  return (
    <section className="flex flex-col gap-3" aria-label={de.start.sectionLabel}>
      <h2 className="wm-display text-host-lg font-bold">{de.start.sectionLabel}</h2>

      {report.pending ? (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="wm-label">{de.start.checksTitle}</h3>

            {reasons.length === 0 ? (
              <p className="text-host-sm text-wm-text-muted" data-prestart-check="ready">
                {de.start.ready}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {reasons.map((reason) => (
                  <li
                    key={reason}
                    className="text-host-sm text-wm-lose"
                    role="alert"
                    data-prestart-check="blocker"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            )}

            {/*
              A shortage is never a refusal: more matches than tables is an
              ordinary club evening, and how long a queue the host accepts is
              their decision (CLAUDE.md golden rule 3).
            */}
            {report.warnings.includes('TABLE_SHORTAGE') ? (
              <p className="text-host-sm text-wm-live" data-prestart-check="warning">
                {de.start.tableShortage({
                  matches: report.preview.matches,
                  tables: report.preview.tables,
                  queued: report.preview.queued,
                })}
              </p>
            ) : null}
          </div>

          <Preview report={report} participant={participant} />

          <div>
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onStart}
              disabled={!report.canStart}
              // The reason is on the control the click was aimed at, for both
              // the pointer and the screen reader.
              title={
                reasons[0] === undefined ? undefined : de.start.blocked({ reason: reasons[0] })
              }
              aria-label={
                reasons[0] === undefined
                  ? de.start.action
                  : de.start.blocked({ reason: reasons[0] })
              }
              data-prestart-action="start"
            >
              {de.start.action}
            </button>
          </div>
        </>
      ) : (
        <p className="text-host-sm text-wm-text-muted" data-prestart-state="running">
          {de.start.running}
        </p>
      )}
    </section>
  );
}

/**
 * What the first round will be, before a single value of the RNG is consumed.
 *
 * The `Freilos` is the line that earns this section. An odd count means
 * somebody advances without playing, and the host can still prevent that by
 * asking one more person to join — but only if they are told **before** the
 * draw (issue #15 acceptance criteria, docs/TOURNAMENT-RULES.md §3).
 */
function Preview({
  report,
  participant,
}: {
  report: PreStartReport;
  participant: ParticipantLabel;
}) {
  const words = de.participant[participant];

  return (
    <div className="flex flex-col gap-1">
      <h3 className="wm-label">{de.start.previewTitle}</h3>

      <p className="wm-tnum text-host-sm text-wm-text" data-prestart-preview="matches">
        {de.start.previewMatches({ n: report.preview.matches })}
      </p>
      <p className="text-host-sm text-wm-text-muted" data-prestart-preview="participants">
        {words.count({ n: report.preview.participants })}
      </p>

      {report.preview.bye ? (
        <p className="text-host-sm text-wm-live" data-prestart-preview="bye">
          {words.byePreview}
        </p>
      ) : null}
    </div>
  );
}

/** The German for a blocker, in the wording this tournament uses. */
function blockerText(blocker: PreStartBlocker, participant: ParticipantLabel): string {
  switch (blocker) {
    case 'TOO_FEW_GROUPS':
      return de.participant[participant].tooFew;
    case 'NO_USABLE_TABLE':
      return de.start.noUsableTable;
  }
}

/**
 * The most consequential button in the app, so it is the largest
 * (docs/STYLEGUIDE.md §3: 40 px for high-frequency or destructive actions — this
 * is neither frequent nor destructive, but it is the one nobody may miss).
 */
const PRIMARY_CLASS =
  'h-12 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-6 text-host-lg font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';
