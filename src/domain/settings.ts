import type { ParticipantLabel, Tournament } from '@/domain/types';

/**
 * The host's choices about a tournament that are not part of its algorithm
 * (docs/FILE-FORMAT.md `settings`).
 *
 * Pure, like everything in `src/domain`, and deliberately unaware of what any
 * of it says in German: `participantLabel` selects a wording, and the wording
 * itself lives in `src/i18n/de-AT.ts` (CLAUDE.md golden rule 1).
 */

/**
 * Whether the room is playing in `Gruppen`, `Teams` or as `Spieler`
 * (issue #14).
 *
 * Only the German UI changes — the model stays `Group` everywhere, because the
 * three words describe the same thing: one participating unit with a number
 * (docs/GLOSSARY.md, docs/OPEN-QUESTIONS.md #7). Changing it mid-tournament is
 * allowed and costs nothing: it renames nothing and moves nothing, it only
 * decides which noun the host and the audience read.
 */
export function setParticipantLabel(
  tournament: Tournament,
  participantLabel: ParticipantLabel,
): Tournament {
  if (tournament.settings.participantLabel === participantLabel) {
    return tournament;
  }
  return { ...tournament, settings: { ...tournament.settings, participantLabel } };
}
