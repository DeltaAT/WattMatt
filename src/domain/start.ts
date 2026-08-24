import { MINIMUM_GROUPS } from '@/domain/groups';
import { activeGroups, usableTables } from '@/domain/selectors';
import type { Tournament } from '@/domain/types';

/**
 * The gate between setup and a running tournament (issue #15).
 *
 * Everything here answers one question — "may this tournament start, and what
 * will the first round look like?" — before the host presses the button, rather
 * than after fifty people are looking at the projector. Pure and separate from
 * the panel that draws it, because the draw engine (#16) has to refuse exactly
 * the same cases: two answers to "is this ready?" would eventually disagree,
 * and the disagreement would surface as a draw that throws mid-event.
 *
 * The distinction that matters is **blocker versus warning**. A blocker is a
 * tournament that cannot be drawn at all (docs/TOURNAMENT-RULES.md §2: at least
 * two groups, at least one table). A warning is a tournament that will run
 * slowly — more matches than tables — which is a perfectly normal club evening
 * and is emphatically not the app's decision to refuse (CLAUDE.md golden
 * rule 3).
 */

/** What the first qualifying round will look like (docs/TOURNAMENT-RULES.md §3). */
export interface FirstRoundPreview {
  /** `n` — the groups that would be drawn, which is the active ones. */
  participants: number;
  /** `floor(n / 2)` pairs. */
  matches: number;
  /** True at an odd count: the last group left over advances without playing. */
  bye: boolean;
  /** Tables a match could be sent to — everything not `gesperrt`. */
  tables: number;
  /** Matches with no table to go to at the moment of the draw. */
  queued: number;
}

/** A reason the tournament cannot start. Explained in German by the host UI. */
export type PreStartBlocker =
  /** Fewer than `MINIMUM_GROUPS` participants (docs/TOURNAMENT-RULES.md §2). */
  | 'TOO_FEW_GROUPS'
  /** No table at all, or every table taken out of service. */
  | 'NO_USABLE_TABLE';

/** A reason to think twice, which the host is free to ignore. */
export type PreStartWarning =
  /** Far more matches than tables — the round will run in several sittings. */
  'TABLE_SHORTAGE';

export interface PreStartReport {
  /**
   * Whether the tournament is still in `SETUP`.
   *
   * False once it has started, which is not a failed check but a question that
   * no longer applies — the host UI shows the round instead of the button.
   */
  pending: boolean;
  blockers: readonly PreStartBlocker[];
  warnings: readonly PreStartWarning[];
  preview: FirstRoundPreview;
  /** Blockers cleared and not started yet — exactly when `startTournament` acts. */
  canStart: boolean;
}

/**
 * How many times over the tables would have to turn before a shortage is worth
 * saying out loud.
 *
 * Two sittings is an ordinary evening — eight participants on two tables plays
 * four matches in two goes, and nobody would call that a problem. Three is the
 * point at which the last pair is waiting on two full rounds of matches in
 * front of them, which is what the host wants to know *before* they start, while
 * adding a table is still a matter of carrying one in.
 */
const TABLE_SHORTAGE_FACTOR = 2;

/**
 * The full pre-start picture: what is missing, what is risky, what round 1
 * will be.
 *
 * One report rather than a handful of predicates, because the panel shows all
 * of it at once and a host reading a list of checks needs the same list every
 * time — a check that disappears when it passes is one they cannot confirm
 * they have satisfied.
 */
export function preStartReport(tournament: Tournament): PreStartReport {
  const preview = previewFirstRound(tournament);

  const blockers: PreStartBlocker[] = [];
  if (preview.participants < MINIMUM_GROUPS) {
    blockers.push('TOO_FEW_GROUPS');
  }
  if (preview.tables === 0) {
    blockers.push('NO_USABLE_TABLE');
  }

  // Only worth saying when there are tables at all: with none, the blocker
  // above already says the more important thing, and a shortage warning next to
  // it would be two lines about the same missing table.
  const warnings: PreStartWarning[] =
    preview.tables > 0 && preview.matches > preview.tables * TABLE_SHORTAGE_FACTOR
      ? ['TABLE_SHORTAGE']
      : [];

  const pending = tournament.phase === 'SETUP';
  return { pending, blockers, warnings, preview, canStart: pending && blockers.length === 0 };
}

/**
 * What the first round would look like if it were drawn right now
 * (docs/TOURNAMENT-RULES.md §3).
 *
 * Counted, not drawn: no RNG is consumed, so looking at the preview does not
 * move the stream that makes a draw reproducible (CLAUDE.md golden rule 7).
 * The pairing itself is issue #16's, and this must agree with it on two
 * numbers only — how many matches, and whether somebody sits one out.
 */
export function previewFirstRound(tournament: Tournament): FirstRoundPreview {
  const participants = activeGroups(tournament).length;
  const matches = Math.floor(participants / 2);
  const tables = usableTables(tournament).length;

  return {
    participants,
    matches,
    // The `Freilos` the host most needs warned about, because it is the one
    // they can still prevent: one more participant and the count is even
    // (issue #15 acceptance criteria).
    bye: participants % 2 === 1,
    tables,
    queued: Math.max(0, matches - tables),
  };
}

/**
 * Starts the tournament: `SETUP` becomes `QUALIFYING`
 * (docs/TOURNAMENT-RULES.md §1).
 *
 * The phase change and nothing else. Drawing the qualifying round is issue
 * #16's, and keeping the two apart is what lets a host start the evening,
 * announce it, and draw when the room is ready — rather than having the pairing
 * appear on the projector the instant they click.
 *
 * Refused when a blocker is standing, and refused a second time when the
 * tournament has already started. The button is disabled in both cases; the
 * guard is here so a stale click cannot push a started tournament through the
 * phase transition again.
 */
export function startTournament(tournament: Tournament): Tournament {
  if (!preStartReport(tournament).canStart) {
    return tournament;
  }
  return { ...tournament, phase: 'QUALIFYING' };
}
