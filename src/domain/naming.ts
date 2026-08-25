import type { GroupId } from '@/domain/ids';
import { activeGroups } from '@/domain/selectors';
import type { Group, Tournament } from '@/domain/types';

/**
 * The naming phase (issue #23, docs/TOURNAMENT-RULES.md §6).
 *
 * Up to here a participant is a number and nothing else — that is what §0 makes
 * the identity of the whole event. From the moment the field is small enough,
 * the host types a name beside every number, and from then on the room reads
 * names while the app keeps counting in numbers.
 *
 * Two properties are load-bearing.
 *
 * **The number never goes away.** A name is added *beside* the number, never in
 * place of it: the host calls a participant up by number for the rest of the
 * evening, and somebody who only ever hears their name cannot find their table.
 * Every list this module produces carries both.
 *
 * **Nothing here decides *when*.** `settings.namingAt` does — the field size at
 * which names become required (docs/OPEN-QUESTIONS.md #8, #63). It is a
 * separate number from the §5 boundary that ends the elimination rounds, even
 * though the two share a default of 16, and a host who wants names from the
 * start moves the threshold up rather than asking for a different phase.
 *
 * Pure, like everything in `src/domain`: no clock, no randomness, no German.
 * Every function hands the tournament straight back when it is asked for
 * something that cannot happen — an unknown group, an empty name, one that is
 * too long. The host UI stops those at the field; the guard is here so a stale
 * commit during a live event costs nothing rather than writing a tournament
 * that `tournamentSchema` would refuse to reopen.
 */

/**
 * The longest name a host may enter (docs/TOURNAMENT-RULES.md §6).
 *
 * Also the beamer's budget, which is why the number is worth pinning rather
 * than picking. 40 characters is what fits one card line at the 32 px floor of
 * docs/STYLEGUIDE.md §2, and that floor is where a long name lands after the
 * projector has stepped its type down — so the longest legal name is the
 * longest one the room can still read whole rather than as an ellipsis
 * (`@/ui/nameFit`).
 */
export const MAX_GROUP_NAME_LENGTH = 40;

/**
 * A name as it is stored: trimmed, and composed.
 *
 * Trimmed because a trailing space is invisible on the host screen and 64 px
 * wide on the projector. Composed (NFC) because a decomposed umlaut is two code
 * points that look identical in the host's field, and the bundled subset fonts
 * carry no combining marks — so it reaches the audience as a broken glyph.
 * Names arrive by paste as often as by typing, and a paste is exactly where a
 * decomposed umlaut comes from (`de-AT.test.ts` guards the locale file the same
 * way, for the same reason).
 */
export function normalizeGroupName(name: string): string {
  return name.normalize('NFC').trim();
}

/**
 * Whether this is a name the tournament will accept.
 *
 * Non-empty and at most `MAX_GROUP_NAME_LENGTH` once normalised, which is §6's
 * rule exactly. Exported so the host field can refuse a name at the keyboard
 * rather than accepting it and silently dropping it a layer down.
 */
export function isValidGroupName(name: string): boolean {
  const normalized = normalizeGroupName(name);
  return normalized !== '' && normalized.length <= MAX_GROUP_NAME_LENGTH;
}

/**
 * Names a group, or corrects the name it already has.
 *
 * Correcting is the same call as entering, deliberately: a typo surfaces the
 * moment the name hits the beamer at 64 px, and the way back must not be
 * undoing everything that has happened since (issue #23). Undo still covers the
 * misclick that *replaced* a good name, because this is one commit like any
 * other (CLAUDE.md golden rule 6).
 *
 * Allowed for a group that is already `ELIMINATED`. They still appear in the
 * round history the host puts back on the projector, and a name that could not
 * be fixed once the participant had lost would be a typo the room reads all
 * evening.
 */
export function setGroupName(tournament: Tournament, groupId: GroupId, name: string): Tournament {
  if (!isValidGroupName(name)) {
    return tournament;
  }

  const normalized = normalizeGroupName(name);
  const target = tournament.groups.find((group) => group.id === groupId);
  if (target === undefined || target.name === normalized) {
    return tournament;
  }

  return {
    ...tournament,
    groups: tournament.groups.map((group) =>
      group.id === groupId ? { ...group, name: normalized } : group,
    ),
  };
}

/** One row of the naming list: the number that stays, and the name beside it. */
export interface NamingEntry {
  groupId: GroupId;
  /** The identity of a participant for the whole event, badge included (§0). */
  number: number;
  /** Null until the host has typed one. */
  name: string | null;
  /**
   * Whether another remaining group carries the same name.
   *
   * A warning and never a refusal: two teams may genuinely be called the same
   * thing, and rejecting the second one would leave the host inventing a name
   * for somebody in front of the room (§6).
   */
  isDuplicate: boolean;
}

/**
 * The naming list and the numbers the host reads off it.
 *
 * Returned as one object rather than as four separate reads, for the reason
 * `RepechageState` gives: the panel's heading, its progress line and its gate
 * are three views of one calculation, and two of them disagreeing about how
 * many names are missing is a host being told to keep typing into a full list.
 */
export interface NamingState {
  entries: readonly NamingEntry[];
  /** How many of them have a name — the numerator of "12 von 16". */
  named: number;
  total: number;
  /** How many entries share their name with another. Usually zero. */
  duplicates: number;
  /** Every remaining group has a name, so the bracket may be drawn (§6). */
  complete: boolean;
}

/**
 * Whether the host should be asked for names at all.
 *
 * Keyed on the field that is left rather than on `phase`, which is what
 * docs/OPEN-QUESTIONS.md #63 settles: `NAMING` is a phase of §1, `namingAt` is
 * a threshold, and a host who moved the threshold up wants to type names during
 * the setup they are sitting in — not to be told the phase has not arrived yet.
 *
 * Closed while nobody is left to name, which is the tournament that has just
 * been created and has no participants in it.
 */
export function isNamingOpen(tournament: Tournament): boolean {
  const remaining = activeGroups(tournament).length;
  return remaining > 0 && remaining <= tournament.settings.namingAt;
}

/**
 * Whether every remaining group has a name.
 *
 * The gate §6 puts in front of the bracket: it "cannot be drawn until every
 * remaining group has a name". Exported for the draw issue #24 adds, and read
 * by the panel so the host can see the gate while they are still typing rather
 * than meeting a greyed-out button afterwards.
 *
 * Only the groups still in are counted. A participant knocked out in round one
 * was never asked for a name and must not hold the final phase up.
 */
export function isNamingComplete(tournament: Tournament): boolean {
  return activeGroups(tournament).every((group) => group.name !== null);
}

/**
 * The list the host types into, ordered by group number.
 *
 * By number rather than by creation order or by who is left: the host works
 * down a sheet of paper, and a list that silently skipped 3 and 7 would have
 * them entering a name against the wrong row. The gaps are real — those
 * participants are out — and the numbers are what make them visible.
 */
export function namingState(tournament: Tournament): NamingState | null {
  if (!isNamingOpen(tournament)) {
    return null;
  }

  const remaining = [...activeGroups(tournament)].sort((a, b) => a.number - b.number);
  const shared = sharedNames(remaining);

  const entries = remaining.map((group) => ({
    groupId: group.id,
    number: group.number,
    name: group.name,
    isDuplicate: group.name !== null && shared.has(foldName(group.name)),
  }));

  const named = entries.filter((entry) => entry.name !== null).length;

  return {
    entries,
    named,
    total: entries.length,
    duplicates: entries.filter((entry) => entry.isDuplicate).length,
    complete: named === entries.length,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The names carried by more than one remaining group.
 *
 * Compared case-insensitively: the same team typed twice is the way this
 * collision actually happens, and a warning that only fired on an exact match
 * would miss two people entering the same name into two different rows.
 */
function sharedNames(groups: readonly Group[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();

  for (const group of groups) {
    if (group.name === null) {
      continue;
    }
    const folded = foldName(group.name);
    if (seen.has(folded)) {
      shared.add(folded);
    }
    seen.add(folded);
  }

  return shared;
}

/**
 * A name reduced to what two of them have to differ in to count as different.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the domain is deterministic and
 * must not read the machine's locale (docs/ARCHITECTURE.md §5). German loses
 * nothing by it — the umlauts map, and the sharp s stays itself on both sides of
 * the comparison.
 */
function foldName(name: string): string {
  return name.toLowerCase();
}
