import type { GroupId } from '@/domain/ids';
import type { RepechageBlocker, RepechageState } from '@/domain/repechage';
import type { Group, ParticipantLabel, RepechageFallback, RoundTrack } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';
import { RepechageFallbackDialog } from '@/windows/host/RepechageFallbackDialog';

/**
 * The `Hoffnungsrunde` control panel (issue #21, docs/TOURNAMENT-RULES.md §4).
 *
 * The host is narrating this phase to the room, so the panel is laid out in the
 * order they will speak it: what the target is and how many places are left,
 * then the one button that draws, then — the moment somebody is drawn — the
 * name, large, with the two answers under it and nothing else competing for the
 * click.
 *
 * **The two answers are the whole design.** They appear only while a candidate
 * is pending, and the draw button is disabled behind them: the host can never
 * accidentally draw two candidates at once, and cannot answer a candidate who
 * was never drawn.
 *
 * Presentational. Every decision comes in as a callback from `useRepechage`,
 * which is what lets the whole panel be rendered in a test without a store.
 */
export function RepechagePanel({
  state,
  target,
  blockers,
  canStart,
  canDraw,
  groups,
  participant,
  track = 'MAIN',
  onStart,
  onDraw,
  onAccept,
  onDecline,
  onFallback,
  onShowOnBeamer,
}: {
  /** Null before the phase is started — the panel then offers to start it. */
  state: RepechageState | null;
  /** Known before the phase begins, from the qualifying round's pairings. */
  target: number | null;
  blockers: readonly RepechageBlocker[];
  canStart: boolean;
  canDraw: boolean;
  groups: readonly Group[];
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  /**
   * Which of the two tournaments' places are being drawn (issue #91, §10).
   *
   * The same lottery — same target, same pot, same two answers — run for the
   * `Trostrunde` on its own field. What differs is what *Nein* costs, and the
   * panel says so out loud on the side event's copy: there is no second level,
   * so declining here means going home.
   *
   * Defaulted, so the main field's panel is exactly what it was.
   */
  track?: RoundTrack;
  onStart: () => void;
  onDraw: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onFallback: (choice: RepechageFallback) => void;
  onShowOnBeamer: () => void;
}) {
  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const name = (groupId: GroupId) => groupLabel(groupId, byId, participant).text;
  const reason = blockers.map(blockerText)[0];

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={track === 'MAIN' ? de.repechage.sectionLabel : de.consolation.repechageLabel}
      data-repechage-track={track}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">
          {track === 'MAIN' ? de.repechage.label : de.consolation.repechageLabel}
        </h2>

        {state === null ? null : (
          <>
            <span className="wm-tnum text-host-sm text-wm-text" data-repechage-target="">
              {de.repechage.target({ n: state.target })}
            </span>
            <span className="wm-tnum text-host-sm text-wm-text" data-repechage-field="">
              {de.repechage.field({ n: state.size })}
            </span>
            {/*
              The number the whole phase is about, and the one the host says out
              loud most often. It stays on screen once it reaches zero, worded as
              a full stop rather than as "0 Plätze frei": a counter that vanished
              would leave the host looking for it.
            */}
            <span className="wm-tnum text-host-sm font-semibold" data-repechage-need="">
              {state.need === 0
                ? de.repechage.slotsFilled
                : de.repechage.slotsLeft({ n: state.need })}
            </span>
            {state.byes === 0 ? null : (
              <span className="text-host-sm text-wm-accent" data-repechage-byes="">
                {de.repechage.byes({ n: state.byes })}
              </span>
            )}
          </>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onShowOnBeamer}
            disabled={state === null}
            data-repechage-action="beamer"
          >
            {de.repechage.showOnBeamer}
          </button>

          {state === null ? (
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onStart}
              disabled={!canStart}
              // The reason is on the control the click was aimed at, for both
              // the pointer and the screen reader (the round panel does the
              // same).
              title={reason === undefined ? undefined : de.repechage.blocked({ reason })}
              aria-label={
                reason === undefined ? de.repechage.start : de.repechage.blocked({ reason })
              }
              data-repechage-action="start"
            >
              {de.repechage.start}
            </button>
          ) : (
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onDraw}
              disabled={!canDraw}
              // The two reasons the host will actually hit: a candidate still
              // waiting for an answer, and a pot that has run dry.
              title={drawReason(state)}
              aria-label={drawReason(state) ?? de.repechage.draw}
              data-repechage-action="draw"
            >
              {de.repechage.draw}
            </button>
          )}
        </div>
      </header>

      {/*
        The one sentence that is only true of the side event's lottery
        (issue #91): the `Trostrunde` has no `Trostrunde`, so a group that turns
        this down is out for the evening. It sits above the candidate rather
        than beside the buttons, so the host has read it before anybody is drawn
        and can say it to the room without being asked.
      */}
      {track === 'MAIN' ? null : (
        <p className="text-host-sm font-semibold text-wm-text" data-repechage-hint="">
          {de.consolation.repechageHint}
        </p>
      )}

      {state === null ? (
        // Either there is a reason the phase cannot start, or there is not and
        // what is left to say is what the phase is for — which is the sentence
        // the host reads out to the room before they press the button.
        <p className="text-host-sm text-wm-text-muted" data-repechage-intro="">
          {reason ?? (target === null ? de.repechage.label : de.repechage.intro({ target }))}
        </p>
      ) : (
        <>
          {state.pending === null ? null : (
            <Candidate name={name(state.pending)} onAccept={onAccept} onDecline={onDecline} />
          )}

          {state.complete ? (
            <p className="text-host-sm text-wm-win" data-repechage-complete="">
              {de.repechage.complete}
            </p>
          ) : null}

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
            <List
              title={de.repechage.throughTitle}
              ids={state.through}
              name={name}
              empty={null}
              which="through"
            />
            <List
              title={de.repechage.poolTitle}
              ids={state.pool}
              name={name}
              empty={de.repechage.poolEmpty}
              which="pool"
            />
            <List
              title={de.repechage.declinedTitle}
              ids={state.declined}
              name={name}
              empty={de.repechage.declinedEmpty}
              which="declined"
            />
          </div>

          {/*
            Not a state the host can dismiss their way out of: the field has to
            reach the target or there is no bracket to build, so the dialog
            stays until one of §4's two answers is taken. `Freilose vergeben` is
            always one of them, which is what makes every path out reachable.
          */}
          {state.fallbackNeeded ? (
            <RepechageFallbackDialog
              need={state.need}
              declined={state.declined.length}
              onAnswer={onFallback}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The drawn candidate, and the only two things the host may do about them.
 *
 * The name is large because it is what the host reads out; the two buttons are
 * wide, apart, and worded as two different verbs, because this is the click
 * that must not go wrong — an accidental *Verzichtet* puts somebody out of the
 * tournament in front of the room they just lost in.
 */
function Candidate({
  name,
  onAccept,
  onDecline,
}: {
  name: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-wm-lg border border-wm-accent bg-wm-accent-soft p-4"
      data-repechage-candidate=""
    >
      <div className="flex flex-col">
        <span className="wm-label">{de.repechage.question}</span>
        <span className="wm-display text-host-lg font-bold" data-candidate-name="">
          {name}
        </span>
      </div>

      <div className="ml-auto flex gap-3">
        <button
          type="button"
          className={ACCEPT_CLASS}
          onClick={onAccept}
          data-repechage-action="accept"
        >
          {de.repechage.accept}
        </button>
        <button
          type="button"
          className={DECLINE_CLASS}
          onClick={onDecline}
          data-repechage-action="decline"
        >
          {de.repechage.decline}
        </button>
      </div>
    </div>
  );
}

function List({
  title,
  ids,
  name,
  empty,
  which,
}: {
  title: string;
  ids: readonly GroupId[];
  name: (groupId: GroupId) => string;
  /** What to say when the list is empty, or null to say nothing at all. */
  empty: string | null;
  which: string;
}) {
  return (
    <section className="flex flex-col gap-1" data-repechage-list={which}>
      <h3 className="wm-label">
        {title} <span className="wm-tnum">{ids.length}</span>
      </h3>

      {ids.length === 0 ? (
        empty === null ? null : (
          <p className="text-host-sm text-wm-text-muted">{empty}</p>
        )
      ) : (
        <ul className="flex flex-wrap gap-1">
          {ids.map((groupId) => (
            <li
              key={groupId}
              className="rounded-wm-sm bg-wm-surface px-2 py-1 text-host-sm text-wm-text"
              data-group-id={groupId}
            >
              {name(groupId)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Why the draw button is doing nothing, or undefined when it is not. */
function drawReason(state: RepechageState): string | undefined {
  if (state.pending !== null) {
    return de.repechage.drawPending;
  }
  if (state.need === 0) {
    return de.repechage.slotsFilled;
  }
  return state.pool.length === 0 ? de.repechage.drawPoolEmpty : undefined;
}

function blockerText(blocker: RepechageBlocker): string {
  switch (blocker) {
    case 'NOT_AFTER_QUALIFYING':
      return de.repechage.notAfterQualifying;
    case 'QUALIFYING_NOT_CLOSED':
      return de.repechage.qualifyingNotClosed;
    case 'ALREADY_STARTED':
      return de.repechage.alreadyStarted;
    case 'NOT_NEEDED':
      return de.repechage.notNeeded;
  }
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';

/*
 * 48 px rather than 40, and each in its own colour: this is the one decision of
 * the phase, taken once per candidate, and it is worth the larger target
 * (docs/STYLEGUIDE.md §3). The colour is never the only signal — the two words
 * say which is which (§1).
 */
const ACCEPT_CLASS =
  'h-12 rounded-wm-md border-2 border-wm-win bg-wm-win-bg px-5 text-host-base font-semibold text-wm-text transition-opacity duration-[--dur-fast] ease-out hover:opacity-90';

const DECLINE_CLASS =
  'h-12 rounded-wm-md border-2 border-wm-lose bg-wm-lose-bg px-5 text-host-base font-semibold text-wm-text transition-opacity duration-[--dur-fast] ease-out hover:opacity-90';
