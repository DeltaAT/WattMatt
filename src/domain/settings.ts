import type { ParticipantLabel, Tournament } from '@/domain/types';

/**
 * The host's choices about a tournament that are not part of its algorithm
 * (docs/FILE-FORMAT.md `settings`), plus the tournament's own name.
 *
 * Pure, like everything in `src/domain`, and deliberately unaware of what any
 * of it says in German: `participantLabel` selects a wording, and the wording
 * itself lives in `src/i18n/de-AT.ts` (CLAUDE.md golden rule 1).
 *
 * Every function hands the tournament straight back when it is asked for
 * something that cannot happen — an empty name, a threshold below the smallest
 * field there is, a setting that is locked because the phase has moved past it.
 * The host UI disables those controls and says why; the guard is here so a
 * stale click during a live event costs nothing rather than writing a
 * tournament that `tournamentSchema` would refuse to reopen.
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

/**
 * Renames the tournament (issue #15).
 *
 * Trimmed, and an empty result is refused rather than stored: `tournamentSchema`
 * requires a non-empty name, so accepting one would write a file that cannot be
 * opened again — and a tournament with no name is a blank heading on the file
 * bar and an unnameable entry in the library.
 *
 * The file on disk keeps the name it was created under. The file name is
 * derived once, when the tournament first reaches the library
 * (docs/OPEN-QUESTIONS.md #26); renaming the *event* an hour later must not
 * move the bytes the host has been autosaving into, and a host who wants the
 * file to match uses *Speichern unter…*.
 */
export function setTournamentName(tournament: Tournament, name: string): Tournament {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === tournament.name) {
    return tournament;
  }
  return { ...tournament, name: trimmed };
}

/**
 * The smallest field a naming threshold can name.
 *
 * Two, because the final is two (docs/TOURNAMENT-RULES.md §7). A threshold of
 * one would ask for names when one participant is left, which is the
 * `Siegerehrung` and not a phase anyone can enter a name in.
 */
export const MINIMUM_NAMING_AT = 2;

/**
 * The field size at which participants stop being numbers and get names
 * (docs/TOURNAMENT-RULES.md §6, docs/OPEN-QUESTIONS.md #8).
 *
 * Configurable because a host may want names from the start — a school final
 * with eight teams reads better as names than as numbers — while the default of
 * 16 is the field the rules name.
 *
 * Refused once the naming phase has been reached: see `isNamingAtEditable`.
 */
export function setNamingAt(tournament: Tournament, namingAt: number): Tournament {
  if (!isNamingAtEditable(tournament) || !isValidNamingAt(namingAt)) {
    return tournament;
  }
  if (tournament.settings.namingAt === namingAt) {
    return tournament;
  }
  return { ...tournament, settings: { ...tournament.settings, namingAt } };
}

/** Whether `setNamingAt` would accept this threshold at all. */
export function isValidNamingAt(namingAt: number): boolean {
  return Number.isSafeInteger(namingAt) && namingAt >= MINIMUM_NAMING_AT;
}

/**
 * Whether the naming threshold may still be changed.
 *
 * It may, for the whole of the tournament up to the naming phase — the host
 * decides how they want to run their event, and until names are asked for the
 * threshold has decided nothing. From `NAMING` onwards it is locked: the app
 * has already told the room that this is where names are entered, and moving
 * the line afterwards would either demand names nobody was asked for or leave
 * a bracket half-named.
 *
 * Exported so the host UI can grey the field out and say why, rather than
 * offering an input that silently refuses what is typed into it.
 */
export function isNamingAtEditable(tournament: Tournament): boolean {
  return !NAMES_REQUESTED.has(tournament.phase);
}

/** The phases from `NAMING` on — every one of them past the threshold. */
const NAMES_REQUESTED = new Set<Tournament['phase']>(['NAMING', 'BRACKET', 'CEREMONY']);

/**
 * Halves animation durations for weak graphics or a laggy projector
 * (docs/MOTION.md §6 "Performance mode").
 *
 * Never locked. It is the one setting whose whole point is being reachable
 * mid-event: the host turns it on because the projector is stuttering *now*,
 * and MOTION.md requires it to take effect without reloading the beamer window
 * — which it does, because it travels in the snapshot like everything else the
 * beamer draws (docs/OPEN-QUESTIONS.md #43).
 */
export function setPerformanceMode(tournament: Tournament, performanceMode: boolean): Tournament {
  if (tournament.settings.performanceMode === performanceMode) {
    return tournament;
  }
  return { ...tournament, settings: { ...tournament.settings, performanceMode } };
}
