import type { GroupId, MatchId } from '@/domain/ids';
import { bracketNodeMatch } from '@/domain/lookup';
import type { Match, Round, Tournament } from '@/domain/types';

/**
 * Who has already played whom (issue #72, docs/TOURNAMENT-RULES.md §3).
 *
 * Two groups drawn against each other twice looks like a bug from the third
 * row: the room watched them play, and now the app is asking them to play
 * again. The draw engine avoids that, and this module is the memory it avoids
 * it with.
 *
 * **Derived, never stored.** There is no second copy of the pairings anywhere
 * in the file — the rounds and the bracket *are* the history, and a stored
 * `playedAgainst` would drift the first time a host undid a round or corrected
 * a result. That is also why `isRematch` is a question this module answers
 * rather than a flag on a match: a flag would have to be kept in step with the
 * very history it describes, and the two would eventually disagree in front of
 * an audience (issue #72, docs/OPEN-QUESTIONS.md #71).
 *
 * The order matters. A pairing is a *rematch* only if the same two groups have
 * met **earlier**, so the pairings are walked in the order they were drawn —
 * rounds in file order, matches in draw order, then the bracket, which is
 * always the last thing drawn (docs/TOURNAMENT-RULES.md §1).
 */

/** Every opponent each group has already faced. Symmetric by construction. */
export type MatchHistory = ReadonlyMap<GroupId, ReadonlySet<GroupId>>;

/** A history that remembers nothing — the field before its first round. */
export const NO_HISTORY: MatchHistory = new Map();

/**
 * One pairing that was actually drawn, in the order it was drawn.
 *
 * A bye is not a pairing and never appears here: nobody played it, so it says
 * nothing about who may be drawn against whom next (§3, §9 case 1).
 */
interface Meeting {
  matchId: MatchId;
  a: GroupId;
  b: GroupId;
}

/**
 * Every pairing this tournament has produced, oldest first.
 *
 * Bracket nodes count, and they come last: the tree is drawn after every round
 * (§1), and a node with both slots filled is a match that is played on a table
 * like any other (`bracketNodeMatch`, docs/OPEN-QUESTIONS.md #68).
 */
function meetings(tournament: Tournament): readonly Meeting[] {
  const played: Meeting[] = [];

  const add = (match: Match | null) => {
    if (match === null || match.b === null) {
      return;
    }
    played.push({ matchId: match.id, a: match.a, b: match.b });
  };

  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      add(match);
    }
  }
  for (const node of tournament.bracket?.nodes ?? []) {
    add(bracketNodeMatch(node));
  }

  return played;
}

/**
 * Who has played whom, for the next draw to work around.
 *
 * Everything the tournament has played so far, because nothing has been drawn
 * yet at the point this is asked — the next round is the first thing that could
 * repeat any of it.
 */
export function playedAgainst(tournament: Tournament): MatchHistory {
  const history = new Map<GroupId, Set<GroupId>>();

  const remember = (a: GroupId, b: GroupId) => {
    const opponents = history.get(a);
    if (opponents === undefined) {
      history.set(a, new Set([b]));
      return;
    }
    opponents.add(b);
  };

  for (const meeting of meetings(tournament)) {
    remember(meeting.a, meeting.b);
    remember(meeting.b, meeting.a);
  }

  return history;
}

/** Whether these two have met. Order-free — the history is symmetric. */
export function havePlayed(history: MatchHistory, a: GroupId, b: GroupId): boolean {
  return history.get(a)?.has(b) === true;
}

/**
 * Every match that repeats a meeting the tournament has already staged.
 *
 * The **later** of the two is the rematch, which is why this walks the pairings
 * in draw order rather than counting them: the first time two groups meet is an
 * ordinary match, and flagging both would put a warning on a round the host
 * already played cleanly.
 *
 * These are exactly the pairings the engine could not avoid. `drawPairing`
 * takes a rematch only when no rematch-free pairing of the field exists at all
 * (`@/domain/pairing`), so a rematch in a drawn round is by definition a forced
 * one — with the single documented exception of the bracket after its first
 * round, where opponents come from who wins rather than from a draw
 * (docs/TOURNAMENT-RULES.md §7).
 */
export function rematchIds(tournament: Tournament): ReadonlySet<MatchId> {
  const seen = new Set<string>();
  const rematches = new Set<MatchId>();

  for (const meeting of meetings(tournament)) {
    const key = pairKey(meeting.a, meeting.b);
    if (seen.has(key)) {
      rematches.add(meeting.matchId);
      continue;
    }
    seen.add(key);
  }

  return rematches;
}

/**
 * The matches of one round that repeat an earlier meeting.
 *
 * The round has to be one of the tournament's own — the ids are matched against
 * the history the whole document produced, which is what makes "earlier" mean
 * anything.
 */
export function rematchesIn(tournament: Tournament, round: Round): readonly Match[] {
  const ids = rematchIds(tournament);
  return round.matches.filter((match) => ids.has(match.id));
}

/**
 * The two ids as one comparable key, smaller first.
 *
 * Sorted rather than stored both ways round: a meeting is unordered, and `a`
 * and `b` are only sides of a card.
 */
function pairKey(a: GroupId, b: GroupId): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}
