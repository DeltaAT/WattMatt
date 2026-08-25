import { useState } from 'react';

import type { GroupId } from '@/domain/ids';
import { isValidGroupName, MAX_GROUP_NAME_LENGTH, type NamingState } from '@/domain/naming';
import type { ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';

/**
 * The naming list: a name for every participant still in (issue #23,
 * docs/TOURNAMENT-RULES.md §6).
 *
 * The host types sixteen names with a room waiting, so this panel is built for
 * exactly that minute and nothing else.
 *
 * **It is a keyboard, not a form.** Every row is one input and nothing else, so
 * Tab walks the list in numbered order without landing on a button in between,
 * and Enter commits and moves on — the host's hands never have to find the
 * mouse. Escape puts the row back the way it was, which is the way out of a
 * half-typed name.
 *
 * **The number stays.** It is the identity of a participant for the whole event
 * (§0), it is what the host calls out at the tables, and it is what the row is
 * *for* — the name goes beside it, never instead of it. The badge is on the row
 * for the rest of the evening, not only while the field is empty.
 *
 * **A duplicate is a warning.** Two teams may genuinely share a name (§6), so
 * the row says so and keeps it. Only an empty name is refused, and the field
 * puts the old one back rather than leaving something on screen that was never
 * committed.
 *
 * Presentational. Every decision comes in as a callback from `useNaming`, which
 * is what lets the whole panel be rendered in a test without a store.
 */
export function NamingPanel({
  state,
  participant,
  onRename,
  onShowOnBeamer,
}: {
  /** Null while names are not being asked for — the panel is then absent. */
  state: NamingState | null;
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  onRename: (groupId: GroupId, name: string) => void;
  /** Puts the neutral holding picture on the projector (`NAMING`). */
  onShowOnBeamer: () => void;
}) {
  if (state === null) {
    return null;
  }

  const words = de.participant[participant];
  const missing = state.total - state.named;

  return (
    <section className="flex flex-col gap-3" aria-label={de.naming.sectionLabel}>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">{de.naming.sectionLabel}</h2>

        {/*
          The counter the issue asks for, in the header where it can be caught
          out of the corner of an eye — the host is looking at their keyboard,
          not at this line, and glances up between names.
        */}
        <span className="wm-tnum text-host-sm font-semibold" data-naming-progress="">
          {de.naming.progress({ named: state.named, total: state.total })}
        </span>

        <button
          type="button"
          className={`${SECONDARY_CLASS} ml-auto`}
          onClick={onShowOnBeamer}
          data-naming-action="beamer"
        >
          {de.naming.showOnBeamer}
        </button>
      </header>

      <p className="text-host-sm text-wm-text-muted" data-naming-intro="">
        {de.naming.intro}
      </p>

      {/*
        A list of rows and nothing else between them. Anything focusable in
        here — a delete, a "show this one" — would land in the Tab order
        between two names and cost the host a keystroke per participant.
      */}
      <ul
        className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]"
        aria-label={de.naming.sectionLabel}
      >
        {state.entries.map((entry) => (
          <NameRow
            // Keyed by the stored name as well as the id, so a name that
            // arrived from somewhere else — an undo, a file reopened — resets
            // the field instead of leaving a stale one in it that the next blur
            // would write back over the real one (`SettingsPanel` does the
            // same).
            key={`${entry.groupId}:${entry.name ?? ''}`}
            label={words.numbered({ n: entry.number })}
            number={entry.number}
            groupId={entry.groupId}
            name={entry.name}
            isDuplicate={entry.isDuplicate}
            onRename={onRename}
          />
        ))}
      </ul>

      <p className="text-host-xs text-wm-text-faint" data-naming-hint="">
        {de.naming.keyboardHint}
      </p>

      {/*
        The gate in front of the `Turnierbaum`, said while the host is still
        typing rather than as a greyed-out button they meet afterwards (§6).
      */}
      {state.complete ? (
        <p className="text-host-sm text-wm-win" data-naming-gate="complete">
          {de.naming.complete}
        </p>
      ) : (
        <p className="text-host-sm text-wm-live" data-naming-gate="missing">
          {de.naming.missing({ n: missing })}
        </p>
      )}

      {state.duplicates === 0 ? null : (
        <p className="text-host-sm text-wm-text-muted" data-naming-duplicates="">
          {de.naming.duplicateCount({ n: state.duplicates })}
        </p>
      )}
    </section>
  );
}

/**
 * One participant: the number that does not change, and the name that does.
 *
 * Committed on blur and on Enter rather than on every keystroke, so the undo
 * stack holds names and not the letters of one (`@/store/actions/naming`).
 * Enter also moves to the next row, which is what makes sixteen names sixteen
 * presses rather than sixteen presses and sixteen reaches for the mouse.
 */
function NameRow({
  label,
  number,
  groupId,
  name,
  isDuplicate,
  onRename,
}: {
  /** What the host calls this participant: "Gruppe 7". */
  label: string;
  number: number;
  groupId: GroupId;
  name: string | null;
  isDuplicate: boolean;
  onRename: (groupId: GroupId, name: string) => void;
}) {
  const [typed, setTyped] = useState(name ?? '');
  const isDirty = typed !== (name ?? '');
  // Only while the host has actually changed something: an empty field that has
  // not been touched yet is the normal state of this panel for its first
  // minute, and a red line under every one of sixteen rows says nothing.
  const problem = isDirty ? invalidReason(typed) : null;

  const commit = () => {
    // A field the host only tabbed through is not a decision. The action layer
    // would refuse it as well, but the row is where the host's intent is known
    // — and every one of sixteen rows is blurred on the way past.
    if (!isDirty) {
      return;
    }
    // A name the domain would refuse puts the stored one back rather than
    // leaving something on screen that was never committed — the same shape as
    // the tournament's own name field (issue #15).
    if (!isValidGroupName(typed)) {
      setTyped(name ?? '');
      return;
    }
    onRename(groupId, typed);
  };

  return (
    <li className="flex flex-col gap-1" data-group-id={groupId}>
      <label className="flex items-center gap-2">
        {/*
          The badge, in the display face and tabular figures so a column of them
          lines up. It stays for the rest of the event: the host calls the
          number out at the tables whatever the name says (§0).
        */}
        <span
          className="wm-display wm-tnum h-8 w-10 shrink-0 rounded-wm-sm bg-wm-surface text-center text-host-base font-bold leading-8"
          data-naming-number={number}
        >
          {number}
        </span>

        <span className="sr-only">{de.naming.nameLabel({ participant: label })}</span>

        <input
          className={`h-8 min-w-0 flex-1 rounded-wm-sm border bg-wm-bg px-2 text-host-sm text-wm-text ${
            problem === null ? 'border-wm-border-strong' : 'border-wm-lose'
          }`}
          value={typed}
          // The limit of §6, enforced where the host can see it happen rather
          // than by a message after the fact. The domain refuses a longer name
          // as well — this field is not the only way one could arrive.
          maxLength={MAX_GROUP_NAME_LENGTH}
          placeholder={de.naming.placeholder}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Committed before the focus moves, so the next row is typed into
              // a list that already knows about this name — which is what lets
              // the duplicate warning appear as the host works down it.
              event.preventDefault();
              commit();
              focusNextRow(event.currentTarget);
            }
            if (event.key === 'Escape') {
              setTyped(name ?? '');
              event.currentTarget.blur();
            }
          }}
          aria-label={de.naming.nameLabel({ participant: label })}
          data-naming-input={groupId}
        />
      </label>

      {problem === null ? null : (
        <p className="text-host-xs text-wm-lose" data-naming-problem="">
          {problem}
        </p>
      )}

      {/*
        Allowed, and said so on the row itself: the host is looking at this one
        field, and a warning that only appeared in a summary underneath sixteen
        rows is one they would read as an error about a different name.
      */}
      {isDuplicate ? (
        <p className="text-host-xs text-wm-text-muted" data-naming-duplicate="">
          {de.naming.duplicate}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Moves the keyboard to the next name, or lets it go after the last one.
 *
 * Found by walking the rendered fields rather than by index, so a list with
 * gaps in its numbering — which every list here has, because numbers are never
 * reused (§0) — still goes in the order the host is reading.
 */
function focusNextRow(current: HTMLInputElement): void {
  const fields = current.ownerDocument.querySelectorAll<HTMLInputElement>('[data-naming-input]');
  const at = [...fields].indexOf(current);
  if (at === -1) {
    return;
  }

  const next = fields[at + 1];
  if (next === undefined) {
    // The last row. Blurring commits nothing further — `commit` has already
    // run — and hands the keyboard back to the window rather than trapping it
    // in a field the host is finished with.
    current.blur();
    return;
  }
  next.focus();
  next.select();
}

/** Why this field would be refused, in German, or null while it is fine. */
function invalidReason(typed: string): string | null {
  if (isValidGroupName(typed)) {
    return null;
  }
  return typed.trim() === '' ? de.naming.empty : de.naming.tooLong({ n: MAX_GROUP_NAME_LENGTH });
}

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
