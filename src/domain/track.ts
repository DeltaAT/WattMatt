import { activeGroups, consolationGroups } from '@/domain/selectors';
import type {
  Bracket,
  Consolation,
  Group,
  Phase,
  Repechage,
  RoundTrack,
  Tournament,
} from '@/domain/types';

/**
 * The two tournaments, behind one set of names (issue #91,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * The `Trostrunde` runs the **same pipeline** as the main field: a qualifying
 * round, its own `Hoffnungsrunde` when the field is not a power of two,
 * elimination rounds down to sixteen, then a bracket with a `Spiel um Platz 3`.
 * One exception, and only one — it never enters the naming phase, so it is
 * numbers from start to finish.
 *
 * That makes this module the load-bearing one of the whole issue. Everything
 * downstream — the phase machine, the lottery, the tree, the panels, the wall —
 * is written once against a `track`, and this is what a track resolves to. The
 * issue says it in as many words: *if you find yourself copy-pasting the round
 * logic for the Trostrunde, stop; the copy will drift, and every future rule
 * change will have to be made twice and will be forgotten once.*
 *
 * **`MAIN` is the tournament's own fields, untouched.** `phase`, `repechage` and
 * `bracket` stay exactly where they were, which is what makes main-track
 * behaviour byte-identical to before this change — every function keeps the
 * same default and reads the same field. `CONSOLATION` is the matching three
 * inside `consolation`, added in schema v7.
 *
 * **A track with no state is readable and not writable.** A tournament whose
 * host has not been asked about the side event, or who said no, has
 * `consolation: null`; `trackState` answers `SETUP` with nothing in it, and
 * `withTrackState` hands the tournament back unchanged. Every caller therefore
 * gets a total function rather than a null check, and a stale click on a
 * declined side event costs nothing (CLAUDE.md golden rule 3).
 */

/** Where one of the two tournaments stands, and what it has drawn. */
export interface TrackState {
  phase: Phase;
  /** Its `Hoffnungsrunde`, or null when it has not needed one (§4). */
  repechage: Repechage | null;
  /** Its tree, or null until the final phase (§7). */
  bracket: Bracket | null;
}

/**
 * A track that does not exist: a side event nobody has been asked about.
 *
 * `SETUP` rather than a null phase, so the phase machine is total over both
 * tracks. Nothing is ever offered from here, because every step is gated on the
 * side event actually running (`isTrackRunning`).
 */
const NO_TRACK: TrackState = { phase: 'SETUP', repechage: null, bracket: null };

export function trackState(tournament: Tournament, track: RoundTrack = 'MAIN'): TrackState {
  if (track === 'MAIN') {
    return {
      phase: tournament.phase,
      repechage: tournament.repechage,
      bracket: tournament.bracket,
    };
  }

  const consolation = tournament.consolation;
  return consolation === null
    ? NO_TRACK
    : {
        phase: consolation.phase,
        repechage: consolation.repechage,
        bracket: consolation.bracket,
      };
}

/**
 * The tournament with one track moved on.
 *
 * A whole `TrackState` rather than a field at a time, because the transitions
 * that use it change two of the three at once and must not be observable apart:
 * entering the lottery *is* a phase change plus a pot, and drawing the tree *is*
 * a phase change plus a bracket (docs/OPEN-QUESTIONS.md #54).
 *
 * Refused for a side event that does not exist, and for one that is no longer
 * running: a `DECLINED` or `FINISHED` `Trostrunde` has nothing left to advance,
 * and writing a phase into one would put a step back in front of the host for a
 * tournament that is over.
 */
export function withTrackState(
  tournament: Tournament,
  track: RoundTrack,
  next: TrackState,
): Tournament {
  if (track === 'MAIN') {
    return {
      ...tournament,
      phase: next.phase,
      repechage: next.repechage,
      bracket: next.bracket,
    };
  }

  const consolation = tournament.consolation;
  if (consolation === null || consolation.state !== 'RUNNING') {
    return tournament;
  }

  const updated: Consolation = {
    ...consolation,
    phase: next.phase,
    repechage: next.repechage,
    bracket: next.bracket,
  };
  return { ...tournament, consolation: updated };
}

/**
 * Whether this track is a tournament that is currently being played.
 *
 * The main field always is — it is the tournament. The side event is only
 * while `consolation.state` says `RUNNING`, which is what stops every panel
 * offering steps for an event that was declined an hour ago or finished ten
 * minutes ago.
 */
export function isTrackRunning(tournament: Tournament, track: RoundTrack = 'MAIN'): boolean {
  return track === 'MAIN' ? true : tournament.consolation?.state === 'RUNNING';
}

/**
 * The groups still in one of the two tournaments.
 *
 * The two are disjoint by construction — `ACTIVE` and `CONSOLATION` are
 * different statuses — which is what makes "a `Trostrunde` group never appears
 * in a main-field draw" a property of the model rather than of a filter
 * (issue #73).
 */
export function trackGroups(tournament: Tournament, track: RoundTrack = 'MAIN'): readonly Group[] {
  return track === 'MAIN' ? activeGroups(tournament) : consolationGroups(tournament);
}

/**
 * Whether this track's participants get names before their bracket
 * (issue #91, docs/TOURNAMENT-RULES.md §6, §10).
 *
 * The one difference between the two pipelines, and a property of the track
 * rather than a step somebody remembered to skip. The naming phase exists so
 * the last sixteen arrive at the tree as *Die Adler* rather than as `Gruppe 12`
 * (issue #23) — and the side event is deliberately not that: it is numbers from
 * its first round to its final, which is what keeps it legible beside a main
 * tournament that is being played in names at the same moment.
 */
export function hasNamingPhase(track: RoundTrack): boolean {
  return track === 'MAIN';
}
