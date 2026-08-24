import { useEffect, useState } from 'react';

import { MINIMUM_GROUPS } from '@/domain/groups';
import type { GroupId } from '@/domain/ids';
import { participantLabelSchema, type Group, type ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { GroupChip } from '@/ui';

/**
 * Group management: the `+`, the bulk add, and the grid of everyone who is
 * playing (issue #14).
 *
 * The panel the host spends the twenty minutes before the doors open in, so it
 * is built for the keyboard: `+` and Enter each add the next participant
 * without the mouse moving, and "Anzahl Gruppen" takes the whole field in one
 * go. Forty of them has to take seconds, not a minute.
 *
 * Presentational. Every decision comes in as a callback from `useGroups`, which
 * is what lets the whole panel be rendered in a test without a store.
 */
export function GroupPanel({
  groups,
  participant,
  hasStarted,
  canRemove,
  onAdd,
  onRemove,
  onParticipantChange,
  onShowOnBeamer,
}: {
  groups: readonly Group[];
  participant: ParticipantLabel;
  /** True once a round has been drawn — adding then warns first. */
  hasStarted: boolean;
  canRemove: (groupId: GroupId) => boolean;
  onAdd: (count: number) => void;
  onRemove: (groupId: GroupId) => void;
  onParticipantChange: (label: ParticipantLabel) => void;
  onShowOnBeamer: () => void;
}) {
  const words = de.participant[participant];

  /**
   * How many participants the host asked for while the draw has already
   * happened, or null when nothing is pending. A question that is not being
   * asked must not be a dialog that is merely hidden.
   */
  const [pending, setPending] = useState<number | null>(null);

  /**
   * Adds, unless the tournament is already under way — then the host is warned
   * first (issue #14). The warning is not a refusal: the host is in control
   * (CLAUDE.md golden rule 3), they are simply told what a late entry means
   * before the beamer tells them.
   */
  const request = (count: number) => {
    if (hasStarted) {
      setPending(count);
      return;
    }
    onAdd(count);
  };

  useAddShortcut(() => request(1));

  return (
    <section className="flex flex-col gap-3" aria-label={words.many}>
      <header className="flex items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">{words.many}</h2>
        <span className="wm-tnum text-host-xs text-wm-text-faint" data-group-count={groups.length}>
          {words.count({ n: groups.length })}
        </span>

        <ParticipantChoice participant={participant} onChange={onParticipantChange} />

        <button
          type="button"
          className={`${SECONDARY_CLASS} ml-auto`}
          onClick={onShowOnBeamer}
          data-group-action="beamer"
        >
          {words.showOnBeamer}
        </button>
      </header>

      <AddControls words={words} onAdd={request} />

      {groups.length === 0 ? (
        <p className="text-host-sm text-wm-text-muted" data-group-empty="">
          {words.empty}
        </p>
      ) : (
        <>
          {groups.length < MINIMUM_GROUPS ? (
            <p className="text-host-sm text-wm-live" data-group-hint="tooFew">
              {words.tooFew}
            </p>
          ) : null}

          {/*
            Auto-fitting columns rather than a fixed count: the grid holds four
            participants during setup and sixty-four an hour later, and a host
            scrolling past a column of chips cannot see how many are missing.
          */}
          <ul
            className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]"
            aria-label={words.many}
          >
            {groups.map((group) => (
              <GroupChip
                key={group.id}
                group={group}
                participant={participant}
                scale="host"
                action={
                  <RemoveButton
                    label={words.removeNumbered({ n: group.number })}
                    hint={canRemove(group.id) ? null : words.drawn}
                    onRemove={() => onRemove(group.id)}
                  />
                }
              />
            ))}
          </ul>
        </>
      )}

      {pending === null ? null : (
        <AfterDrawDialog
          words={words}
          onConfirm={() => {
            onAdd(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

/**
 * The `+` and the "Anzahl Gruppen" bulk add, side by side.
 *
 * A form rather than two bare buttons, so Enter works — the host is typing a
 * number, and reaching for the mouse afterwards is the slowest thing on this
 * screen. The count is kept as the typed text rather than as a number, because
 * a controlled numeric input that snaps an empty field back to 0 cannot be
 * cleared, and a host who cannot delete a digit ends up with 80 participants.
 */
function AddControls({
  words,
  onAdd,
}: {
  words: (typeof de.participant)[ParticipantLabel];
  onAdd: (count: number) => void;
}) {
  const [typed, setTyped] = useState('');
  const count = Number.parseInt(typed, 10);
  const isValid = Number.isSafeInteger(count) && count > 0 && count <= MAX_BULK_ADD;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid) {
          onAdd(count);
          setTyped('');
        }
      }}
    >
      {/*
        Big, and first: this is the control the issue asks for, and it is the
        one a host presses forty times. It keeps focus after a click, so every
        further participant is one Enter.
      */}
      <button
        type="button"
        className={`${PRIMARY_CLASS} h-12 w-12 text-host-lg`}
        onClick={() => onAdd(1)}
        title={words.add}
        aria-label={words.add}
        data-group-action="add"
      >
        {'+'}
      </button>

      <label className="flex flex-col gap-1">
        <span className="wm-label">{words.bulkAddLabel}</span>
        <input
          className="h-10 w-24 rounded-wm-md border border-wm-border-strong bg-wm-bg px-2 text-host-sm text-wm-text"
          type="number"
          min={1}
          max={MAX_BULK_ADD}
          inputMode="numeric"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          data-group-input="count"
        />
      </label>

      <button type="submit" className={PRIMARY_CLASS} disabled={!isValid} data-group-action="bulk">
        {words.bulkAdd}
      </button>
    </form>
  );
}

/** `Gruppe` / `Team` / `Spieler` — German wording only (issue #14). */
function ParticipantChoice({
  participant,
  onChange,
}: {
  participant: ParticipantLabel;
  onChange: (label: ParticipantLabel) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="wm-label">{de.settings.participantLabel}</span>
      <select
        className="h-8 rounded-wm-sm border border-wm-border-strong bg-wm-bg px-2 text-host-xs text-wm-text"
        value={participant}
        // Parsed rather than cast: a `<select>` value is a string, and the one
        // place a string becomes a `ParticipantLabel` should be the schema that
        // defines what one is.
        onChange={(event) => onChange(participantLabelSchema.parse(event.target.value))}
        data-group-input="participant"
      >
        {participantLabelSchema.options.map((option) => (
          <option key={option} value={option}>
            {de.participant[option].many}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The delete on a chip.
 *
 * Disabled rather than hidden for a participant who has already been drawn, and
 * it says why on hover and to a screen reader: a control that disappears leaves
 * the host looking for it, while one that is greyed out with a reason answers
 * the question (`isRemovable` in `@/domain/groups`).
 */
function RemoveButton({
  label,
  hint,
  onRemove,
}: {
  label: string;
  hint: string | null;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className="h-6 w-6 rounded-wm-sm text-host-xs text-wm-text-faint transition-colors duration-[--dur-fast] ease-out hover:bg-wm-lose-bg hover:text-wm-lose disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={onRemove}
      disabled={hint !== null}
      title={hint ?? label}
      aria-label={hint ?? label}
      data-group-action="remove"
    >
      {'×'}
    </button>
  );
}

/**
 * What a late entry means, said before the host finds out from the beamer.
 *
 * A warning and not a refusal: the participant who turns up after the draw is a
 * real thing that happens, and the host decides what to do about them
 * (docs/TOURNAMENT-RULES.md §3).
 */
function AfterDrawDialog({
  words,
  onConfirm,
  onCancel,
}: {
  words: (typeof de.participant)[ParticipantLabel];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={de.group.afterDrawTitle}
      data-group-dialog="afterDraw"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.group.afterDrawTitle}</h2>
        <p className="text-host-sm text-wm-text-muted">{words.afterDrawBody}</p>

        <div className="flex gap-2">
          <button
            type="button"
            className={PRIMARY_CLASS}
            onClick={onConfirm}
            data-group-action="confirmAdd"
          >
            {words.afterDrawConfirm}
          </button>
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onCancel}
            data-group-action="cancelAdd"
          >
            {de.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `+` and Enter add the next participant, from anywhere in the window
 * (issue #14): forty of them has to take seconds.
 *
 * Registered on the window rather than on the panel, because the host's hands
 * are on the keyboard and their focus is wherever the last click left it.
 *
 * Two guards, and both are about not firing twice. A modifier held means the
 * key belongs to a browser shortcut. And anything focused at all is left alone:
 * a `+` typed into "Anzahl Gruppen" is a digit, and Enter on a focused button
 * is already that button's click — the same press adding one participant here
 * and another there is the kind of bug a host discovers at 41 chips.
 */
function useAddShortcut(add: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '+' && event.key !== 'Enter') {
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || hasFocus(event.target)) {
        return;
      }
      event.preventDefault();
      add();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [add]);
}

/** Whether the press was aimed at something rather than at the window. */
function hasFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target !== target.ownerDocument.body;
}

/**
 * More participants than any event this app is for. Not a rule from
 * docs/TOURNAMENT-RULES.md — a guard against a typo in a number field, where
 * "800" costs the host eight hundred chips to delete during setup.
 */
const MAX_BULK_ADD = 128;

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
