import { useState, type ReactNode } from 'react';

import { MINIMUM_NAMING_AT } from '@/domain/settings';
import type { ParticipantLabel, Settings, TableAssignmentOrder } from '@/domain/types';
import { de } from '@/i18n';
import { ParticipantChoice } from '@/ui';

/**
 * The host's choices about this tournament (issue #15).
 *
 * Everything here is editable **mid-tournament** unless changing it would
 * contradict something the room has already been told — a host reconfigures
 * during an event, and a settings panel that locks itself the moment the
 * tournament starts sends them to a text editor. The one exception is the
 * naming threshold, which is frozen once names have been asked for; it is
 * greyed out with the reason beside it rather than removed, because a control
 * that disappears leaves the host looking for it.
 *
 * Presentational. Every decision comes in as a callback from `useSettings`,
 * which is what lets the whole panel be rendered in a test without a store.
 */
export function SettingsPanel({
  name,
  settings,
  rngSeed,
  isNamingAtEditable,
  onRename,
  onParticipantChange,
  onNamingAtChange,
  onPerformanceModeChange,
  onTableAssignmentOrderChange,
}: {
  name: string;
  settings: Settings;
  /** Shown, never edited: the draws have already been taken from it. */
  rngSeed: string;
  /** False from the naming phase on (`@/domain/settings`). */
  isNamingAtEditable: boolean;
  onRename: (name: string) => void;
  onParticipantChange: (label: ParticipantLabel) => void;
  onNamingAtChange: (namingAt: number) => void;
  onPerformanceModeChange: (performanceMode: boolean) => void;
  onTableAssignmentOrderChange: (order: TableAssignmentOrder) => void;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={de.settings.sectionLabel}>
      <h2 className="wm-display text-host-lg font-bold">{de.settings.sectionLabel}</h2>

      <div className="flex flex-wrap items-start gap-6">
        <NameField
          // Keyed by the name, so a rename that came from somewhere else — an
          // undo, another tournament opened — resets the field rather than
          // leaving a stale one in it that the next blur would write back over
          // the real one. The same pattern as `TableRow`'s label field.
          key={name}
          name={name}
          onRename={onRename}
        />

        <Field label={de.settings.participantLabel} hint={null}>
          {/*
            The same control as the one beside the field of participants, and
            deliberately so: whichever the host reaches for, both read the
            tournament and both write it (`@/ui/ParticipantChoice`).
          */}
          <ParticipantChoice
            participant={settings.participantLabel}
            onChange={onParticipantChange}
          />
        </Field>

        <NamingAtField
          key={settings.namingAt}
          namingAt={settings.namingAt}
          editable={isNamingAtEditable}
          onChange={onNamingAtChange}
        />

        <TableAssignmentOrderField
          order={settings.tableAssignmentOrder}
          onChange={onTableAssignmentOrderChange}
        />

        <Field label={de.settings.performanceMode} hint={de.settings.performanceModeHint}>
          <label className="flex h-8 items-center gap-2 text-host-sm text-wm-text">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={settings.performanceMode}
              onChange={(event) => onPerformanceModeChange(event.target.checked)}
              data-settings-input="performanceMode"
            />
            {de.settings.performanceMode}
          </label>
        </Field>

        <Seed rngSeed={rngSeed} />
      </div>
    </section>
  );
}

/**
 * The tournament's name.
 *
 * Committed on blur and on Enter rather than on every keystroke, the same way a
 * table is renamed (`TableRow`): a commit per character would fill the undo
 * stack with fragments of a word, and the host would have to press it once per
 * letter to get the old name back. Escape puts the current name back and gives
 * up, which is the way out of a half-typed rename.
 */
function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [typed, setTyped] = useState(name);

  const commit = () => {
    // The domain refuses an empty name (`tournamentSchema` requires one), so
    // the field puts the old one back rather than leaving a name on screen
    // that was never committed. A name that did not actually change is not
    // reported either: every blur would otherwise reach the store, and merely
    // clicking through the panel is not a decision the host wants back.
    if (typed.trim() === '' || typed.trim() === name) {
      setTyped(name);
      return;
    }
    onRename(typed);
  };

  return (
    <Field label={de.settings.tournamentName} hint={de.settings.tournamentNameHint}>
      <input
        className="h-8 w-64 rounded-wm-sm border border-wm-border-strong bg-wm-bg px-2 text-host-sm text-wm-text"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setTyped(name);
            event.currentTarget.blur();
          }
        }}
        aria-label={de.settings.tournamentName}
        data-settings-input="name"
      />
    </Field>
  );
}

/**
 * The field size at which participants are asked for names
 * (docs/TOURNAMENT-RULES.md §6).
 *
 * Kept as the typed text rather than as a number, for the same reason as the
 * bulk-add field in `GroupPanel`: a controlled numeric input that snaps an
 * empty field back to a number cannot be cleared, and a host who cannot delete
 * a digit cannot type a different one.
 */
function NamingAtField({
  namingAt,
  editable,
  onChange,
}: {
  namingAt: number;
  editable: boolean;
  onChange: (namingAt: number) => void;
}) {
  const [typed, setTyped] = useState(String(namingAt));

  const commit = () => {
    const wanted = Number.parseInt(typed, 10);
    // Anything the domain would refuse puts the current threshold back, for the
    // same reason as the name above, and so does a value that did not change.
    if (!Number.isSafeInteger(wanted) || wanted < MINIMUM_NAMING_AT || wanted === namingAt) {
      setTyped(String(namingAt));
      return;
    }
    onChange(wanted);
  };

  return (
    <Field
      label={de.settings.namingAt}
      hint={editable ? de.settings.namingAtHint : de.settings.namingAtLocked}
    >
      <input
        className="wm-tnum h-8 w-24 rounded-wm-sm border border-wm-border-strong bg-wm-bg px-2 text-host-sm text-wm-text disabled:opacity-60"
        type="number"
        min={MINIMUM_NAMING_AT}
        inputMode="numeric"
        value={typed}
        disabled={!editable}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setTyped(String(namingAt));
            event.currentTarget.blur();
          }
        }}
        aria-label={de.settings.namingAt}
        // The reason travels with the disabled control: a greyed-out field that
        // does not say why is one the host keeps clicking.
        title={editable ? undefined : de.settings.namingAtLocked}
        data-settings-input="namingAt"
      />
    </Field>
  );
}

/**
 * Which end of the table list free tables come from (issue #101,
 * docs/TOURNAMENT-RULES.md §3).
 *
 * Two radios rather than a checkbox: both directions are ordinary choices about
 * a room, and neither is the "on" of the other. A checkbox labelled *Absteigend*
 * would make the host's own hall the exception.
 *
 * Never disabled, at any phase. It decides only what happens next, so flipping
 * it mid-round is a legitimate thing to do — the host has just carried two more
 * tables in at the far end of the hall — and it moves nothing that is already
 * running (`@/domain/settings`). With a single table it has no observable
 * effect and is still offered: a host who adds a second table an hour later
 * should not have to find the option then.
 */
function TableAssignmentOrderField({
  order,
  onChange,
}: {
  order: TableAssignmentOrder;
  onChange: (order: TableAssignmentOrder) => void;
}) {
  return (
    <Field label={de.settings.tableAssignmentOrder} hint={de.settings.tableAssignmentOrderHint}>
      <div
        className="flex h-8 items-center gap-4"
        role="radiogroup"
        aria-label={de.settings.tableAssignmentOrder}
      >
        {TABLE_ASSIGNMENT_ORDERS.map((option) => (
          <label key={option} className="flex items-center gap-2 text-host-sm text-wm-text">
            <input
              type="radio"
              className="h-4 w-4"
              name="tableAssignmentOrder"
              value={option}
              checked={order === option}
              onChange={() => onChange(option)}
              data-settings-input={`tableAssignmentOrder:${option}`}
            />
            {de.settings.tableAssignmentOrderOption[option]}
          </label>
        ))}
      </div>
    </Field>
  );
}

/** Both directions, in the order they read: the current behaviour first. */
const TABLE_ASSIGNMENT_ORDERS: readonly TableAssignmentOrder[] = ['ASCENDING', 'DESCENDING'];

/**
 * The seed every draw is taken from, read-only (CLAUDE.md golden rule 7).
 *
 * On screen so a participant who disputes a pairing can be answered: the draw
 * is reproducible from this value, and a number nobody can read is a number
 * nobody can check.
 */
function Seed({ rngSeed }: { rngSeed: string }) {
  return (
    <Field label={de.settings.seed} hint={de.settings.seedHint}>
      <output
        className="wm-tnum flex h-8 items-center text-host-sm text-wm-text-muted"
        data-settings-value="seed"
      >
        {rngSeed}
      </output>
    </Field>
  );
}

/** One labelled control with the sentence that explains it underneath. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex max-w-sm flex-col gap-1">
      <span className="wm-label">{label}</span>
      {children}
      {hint === null ? null : <p className="text-host-xs text-wm-text-faint">{hint}</p>}
    </div>
  );
}
