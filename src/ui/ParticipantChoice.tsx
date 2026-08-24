import { participantLabelSchema, type ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';

/**
 * `Gruppe` / `Team` / `Spieler` — the German wording this tournament uses
 * (`settings.participantLabel`, issue #14).
 *
 * Shared rather than owned by one panel, because it belongs in two places for
 * two different reasons: beside the field, where the host is when they notice
 * the word is wrong (`GroupPanel`), and in the settings panel, where a host
 * looking for a setting goes to find it (`SettingsPanel`, issue #15). Two
 * copies of a `<select>` would be two places for the parsing below to be
 * forgotten.
 */
export function ParticipantChoice({
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
