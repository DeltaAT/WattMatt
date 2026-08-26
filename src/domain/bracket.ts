import { fieldSize, FINAL_PHASE_SIZE, MINIMUM_BRACKET_SIZE } from '@/domain/draw';
import {
  bracketNodeIdSchema,
  matchIdSchema,
  type BracketNodeId,
  type GroupId,
  type TableId,
} from '@/domain/ids';
import { isNamingComplete } from '@/domain/naming';
import { createRng, type Rng } from '@/domain/rng';
import { nextPowerOfTwo } from '@/domain/round';
import { activeGroups, freeTables } from '@/domain/selectors';
import { occupyTable, releaseTable } from '@/domain/tables';
import type {
  Bracket,
  BracketNode,
  BracketRound,
  Group,
  GroupStatus,
  Timestamp,
  Tournament,
} from '@/domain/types';

/**
 * The `Turnierbaum` (issue #24, docs/TOURNAMENT-RULES.md §7).
 *
 * The last draw of the evening, and the only one the room sees the whole of at
 * once: every remaining participant is shuffled into a slot, and from there the
 * tree is fixed — who could meet whom, and in which round, is settled before
 * the first bracket match is played. That is why §7 asks for a single shuffle
 * rather than a draw per round, and why the acceptance criterion is that
 * `(seed, group list)` determines the whole picture.
 *
 * Three things are load-bearing.
 *
 * **A node is the match.** It carries the pairing, the winner and the table it
 * is played on, exactly as a `Match` in a round does — so the bracket phase
 * appends nothing to `rounds`, and a bracket result has one record rather than
 * two that could disagree (docs/OPEN-QUESTIONS.md #68). The occupancy board
 * still sees those matches, because a node with a pairing *is* one:
 * `bracketNodeMatch` in `@/domain/lookup` is that view, and it is what
 * `table.currentMatchId` names while a `Halbfinale` is being played.
 *
 * **The loser of a `Halbfinale` has not lost the tournament.** They are routed
 * into the `Spiel um Platz 3` in the same object that decides the semi-final,
 * and they stay `ACTIVE` until that match is played. A participant marked out
 * who then appears on the projector in another match is a contradiction the
 * whole room can see (§7, §8).
 *
 * **The bracket does not cascade.** Correcting a result whose winner has
 * already played on is refused rather than silently rewriting the rounds above
 * it — the way back from that is undo, which restores the whole document
 * (CLAUDE.md golden rule 6). Correcting the match the host has just decided,
 * which is the misclick that actually happens, is always allowed (§9 case 8).
 *
 * Pure, like everything in `src/domain`: randomness arrives as an injected
 * `Rng` positioned at the tournament's own cursor, and every function hands its
 * argument straight back when it is asked for something that cannot happen, so
 * a stale click during a live event costs nothing.
 */

/** The prefix docs/FILE-FORMAT.md writes bracket node ids with. */
const NODE_ID_PREFIX = 'bn_';

/**
 * The field size at which a `Spiel um Platz 3` exists at all.
 *
 * Below it there is no `Halbfinale`, so there are no two losers to play it:
 * two participants leave nobody to play for third (§9 case 10).
 */
const SEMI_FINAL_FIELD = 4;

/**
 * The round a field of this size plays, as docs/TOURNAMENT-RULES.md §7 names
 * them: 16 → `Achtelfinale`, 8 → `Viertelfinale`, 4 → `Halbfinale`,
 * 2 → `Finale`.
 *
 * Null for anything else. §5 keeps the final phase at or below 16 and the sizes
 * are powers of two, so the null is not a field the app can reach — it is what
 * stops a hand-repaired file from producing a round with no name. The German
 * names are UI copy and live in `de-AT.ts` (CLAUDE.md golden rule 1).
 */
export function bracketRoundForSize(size: number): BracketRound | null {
  switch (size) {
    case 16:
      return 'ROUND_OF_16';
    case 8:
      return 'QUARTER_FINAL';
    case 4:
      return 'SEMI_FINAL';
    case 2:
      return 'FINAL';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Drawing the bracket
// ---------------------------------------------------------------------------

/** A reason the bracket cannot be drawn right now. Explained in German by #26. */
export type BracketBlocker =
  /** §1 puts `BRACKET` after `NAMING` and nowhere else. */
  | 'NOT_IN_NAMING'
  /** It has been drawn. A second draw would re-deal a tree the room has seen. */
  | 'ALREADY_DRAWN'
  /** §6: the bracket waits until every remaining participant has a name. */
  | 'NAMES_MISSING'
  /** More are still in than the largest bracket §7 names (§5). */
  | 'FIELD_TOO_LARGE'
  /** Fewer than the two a `Finale` needs (§9 case 4). */
  | 'FIELD_TOO_SMALL'
  /** §4 promises a power of two, and this field is not one. */
  | 'FIELD_NOT_POWER_OF_TWO';

/**
 * Everything standing between the host and the bracket, all of it at once.
 *
 * A list rather than a single reason, for the argument `drawBlockers` makes: a
 * host reading a panel of checks needs the same panel every time, and a check
 * that vanishes when it passes is one they cannot confirm they have satisfied.
 */
export function bracketBlockers(tournament: Tournament): readonly BracketBlocker[] {
  const blockers: BracketBlocker[] = [];

  if (tournament.phase !== 'NAMING') {
    blockers.push('NOT_IN_NAMING');
  }
  if (tournament.bracket !== null) {
    blockers.push('ALREADY_DRAWN');
  }
  if (!isNamingComplete(tournament)) {
    blockers.push('NAMES_MISSING');
  }

  // One reason about the field, never three: "too large" and "not a power of
  // two" are both true of a field of 20, and a panel that said so twice would
  // send the host looking for two problems.
  const field = fieldSize(tournament);
  if (field > FINAL_PHASE_SIZE) {
    blockers.push('FIELD_TOO_LARGE');
  } else if (field < MINIMUM_BRACKET_SIZE) {
    blockers.push('FIELD_TOO_SMALL');
  } else if (nextPowerOfTwo(field) !== field) {
    blockers.push('FIELD_NOT_POWER_OF_TWO');
  }

  return blockers;
}

/** Whether `drawBracket` would produce a bracket. */
export function canDrawBracket(tournament: Tournament): boolean {
  return bracketBlockers(tournament).length === 0;
}

export interface DrawBracketInput {
  /**
   * The instant the first bracket matches start on their tables.
   *
   * A timestamp rather than a `Clock`, so one draw stamps every table it fills
   * with the same instant — the room started them together
   * (docs/OPEN-QUESTIONS.md #36).
   */
  at: Timestamp;
  /**
   * Where in the seeded stream this draw happens.
   *
   * Defaults to the tournament's own cursor, which is the only position a live
   * draw may ever run from: an RNG built anywhere else would deal a different
   * tree than the one the file reproduces (CLAUDE.md golden rule 7).
   */
  rng?: Rng;
}

/**
 * Draws the bracket and enters the final phase, in one object
 * (docs/TOURNAMENT-RULES.md §7).
 *
 * The phase moves with the tree, deliberately, and for the reason
 * `startRepechage` gives (docs/OPEN-QUESTIONS.md #54): a `BRACKET` phase with
 * no bracket is a phase with nothing in it, and a bracket drawn while the phase
 * still said `NAMING` would be a tree no panel shows. The two are halves of one
 * decision the host took by pressing one button.
 *
 * The first round's matches are handed the free tables straight away, in node
 * order, by exactly the rules §3 gives the qualifying round — the rest queue,
 * and are offered a table as one frees up (`nextQueuedBracketNode`).
 */
export function drawBracket(
  tournament: Tournament,
  { at, rng = createRng(tournament.rngSeed, tournament.rngCursor) }: DrawBracketInput,
): Tournament {
  if (!canDrawBracket(tournament)) {
    return tournament;
  }

  const bracket = buildBracket(activeGroups(tournament), { rng, size: fieldSize(tournament) });

  // The cursor moves on in the same object as the tree it produced. A draw that
  // recorded the bracket but left the cursor behind would hand the identical
  // shuffle to the next thing that draws (docs/OPEN-QUESTIONS.md #23).
  const withBracket: Tournament = {
    ...tournament,
    phase: 'BRACKET',
    rngCursor: rng.cursor,
    bracket,
  };

  return fillBracketTables(withBracket, at);
}

export interface BuildBracketInput {
  rng: Rng;
  /**
   * The power-of-two field the tree is built for, when it is larger than the
   * list of participants — the `Freilose` §4's fallback still owes
   * (docs/OPEN-QUESTIONS.md #56). Defaults to the smallest power of two the
   * participants fit into, which is the ordinary case.
   */
  size?: number;
}

/**
 * The tree itself: one shuffle, then the slots in order
 * (docs/TOURNAMENT-RULES.md §7).
 *
 * Sequential from the shuffle and nothing cleverer, exactly as `pair` is in the
 * draw engine: the fairness lives in the shuffle, so filling slots in order is
 * as random as any other rule and is the one a host can explain to a
 * participant standing in front of them.
 *
 * A field short of its power of two — which happens only when §4's *Freilose
 * vergeben* was taken at a target no elimination round ever settled — gives the
 * last nodes of the first round one `Freilos` each, so the missing places are
 * spread rather than emptying a node completely. Those nodes are decided by the
 * draw itself and their winner stands in the round above from the start, which
 * is what §3 already does with the bye an odd count earns.
 */
export function buildBracket(groups: readonly Group[], { rng, size }: BuildBracketInput): Bracket {
  const drawn = rng.shuffle(groups);
  const width = bracketWidth(drawn.length, size);
  const { nodes, thirdPlaceNodeId } = layOut(width);

  const seeded = seedFirstRound(
    nodes,
    width,
    drawn.map((group) => group.id),
  );

  return { size: width, nodes: settleByes(seeded), thirdPlaceNodeId };
}

// ---------------------------------------------------------------------------
// Playing the bracket
// ---------------------------------------------------------------------------

/**
 * Marks the winner of a bracket match (docs/TOURNAMENT-RULES.md §7).
 *
 * Three things land in one object, because they are one decision: the winner is
 * recorded and advanced into the node above, the table goes back to `FREE`, and
 * the loser of a `Halbfinale` takes their place in the `Spiel um Platz 3`
 * instead of leaving the tournament.
 *
 * Correcting is the same call with the other group, and it leaves the tree the
 * way a first decision would — the previous winner out of the node above, the
 * previous loser out of the third-place match. It is refused once the result
 * has been played on, that is once the node above (or, for a semi-final, the
 * third-place match) has a winner of its own: rewriting a match the room has
 * already watched is not a correction, and undo is the way back (CLAUDE.md
 * golden rule 6).
 */
export function setBracketWinner(
  tournament: Tournament,
  nodeId: BracketNodeId,
  winnerId: GroupId,
): Tournament {
  const bracket = tournament.bracket;
  if (bracket === null) {
    return tournament;
  }

  const node = findNode(bracket, nodeId);
  // A node with one empty slot is a `Freilos` the draw already decided; one
  // with two is a match whose participants are still being played for (§3, §7).
  if (node === undefined || node.slotA === null || node.slotB === null) {
    return tournament;
  }
  if (winnerId !== node.slotA && winnerId !== node.slotB) {
    return tournament;
  }
  if (node.winnerId === winnerId || isPlayedOn(bracket, node)) {
    return tournament;
  }

  const loserId = winnerId === node.slotA ? node.slotB : node.slotA;
  const playsForThird = node.round === 'SEMI_FINAL' && bracket.thirdPlaceNodeId !== null;

  const decided = bracket.nodes.map((candidate) =>
    candidate.id === node.id ? { ...candidate, winnerId } : candidate,
  );
  const advanced = advance(decided, node.id, winnerId);
  // §7: "the two losers of the `Halbfinale` play the `Spiel um Platz 3`". The
  // loser is put on the same side of it as the winner is of the `Finale`, so
  // the two matches read left to right the same way on the projector.
  const routed = playsForThird
    ? place(advanced, bracket.thirdPlaceNodeId, sideOf(advanced, node.id), loserId)
    : advanced;

  const withBracket: Tournament = {
    ...tournament,
    bracket: { ...bracket, nodes: settleThirdPlace(routed, bracket.thirdPlaceNodeId) },
  };

  return releaseTableOf(restatus(withBracket, winnerId, loserId, playsForThird), node);
}

/**
 * The bracket matches waiting for a table, in node order — which is the order
 * §7 draws them in, and therefore queue order (§3).
 *
 * Keyed on "has a pairing, has no table, has no result", the same physical
 * truth `queuedMatches` reads off a round: a match requeued because its table
 * broke is back in this list at its own position in the tree, ahead of the
 * round above it, which is where it belongs.
 */
export function queuedBracketNodes(bracket: Bracket): readonly BracketNode[] {
  return bracket.nodes.filter(
    (node) =>
      node.slotA !== null && node.slotB !== null && node.winnerId === null && node.tableId === null,
  );
}

/**
 * The bracket match a freed table should be offered next, or null when nothing
 * is waiting.
 *
 * An offer, not an assignment: nothing moves onto the beamer without the host
 * confirming it (CLAUDE.md golden rule 3), so this is the question and
 * `assignNextBracketNode` is the answer.
 */
export function nextQueuedBracketNode(tournament: Tournament): BracketNode | null {
  const bracket = tournament.bracket;
  return bracket === null ? null : (queuedBracketNodes(bracket)[0] ?? null);
}

export interface AssignBracketNodeInput {
  nodeId: BracketNodeId;
  tableId: TableId;
  /** When the match starts on this table (docs/OPEN-QUESTIONS.md #36). */
  at: Timestamp;
}

/**
 * Puts one waiting bracket match onto a free table, by the rules of §3.
 *
 * The table is written by `occupyTable` and nowhere else, exactly as it is for
 * a match in a round — and the node's own `tableId` is set by that same call,
 * which is what keeps the tree and the three fields `tableSchema` ties together
 * in step (docs/OPEN-QUESTIONS.md #68).
 */
export function assignBracketNode(
  tournament: Tournament,
  { nodeId, tableId, at }: AssignBracketNodeInput,
): Tournament {
  const bracket = tournament.bracket;
  if (bracket === null) {
    return tournament;
  }

  const node = findNode(bracket, nodeId);
  if (node === undefined || node.tableId !== null || node.winnerId !== null) {
    return tournament;
  }
  if (node.slotA === null || node.slotB === null) {
    return tournament;
  }

  // `occupyTable` refuses a table that is not `FREE` by handing its argument
  // straight back, so a stale click on a table that has just been taken costs
  // nothing.
  return occupyTable(tournament, { tableId, matchId: matchIdSchema.parse(node.id), at });
}

/**
 * The host's confirmation that the table which just freed up takes the next
 * waiting bracket match (docs/TOURNAMENT-RULES.md §3, §7).
 *
 * Deliberately a separate step from `setBracketWinner`, which frees the table:
 * a final phase where the next pair walked up the moment the last one sat down
 * would take the beamer away from the host mid-sentence.
 */
export function assignNextBracketNode(
  tournament: Tournament,
  { tableId, at }: { tableId: TableId; at: Timestamp },
): Tournament {
  const node = nextQueuedBracketNode(tournament);
  if (node === null) {
    return tournament;
  }
  return assignBracketNode(tournament, { nodeId: node.id, tableId, at });
}

// ---------------------------------------------------------------------------
// Reading the bracket
// ---------------------------------------------------------------------------

/** The podium, in the order the `Siegerehrung` reveals it (§8). */
export interface FinalStandings {
  /** The winner of the `Finale`. */
  first: GroupId | null;
  /** Its loser — second place is lost, not won (docs/TOURNAMENT-RULES.md §7). */
  second: GroupId | null;
  /** The winner of the `Spiel um Platz 3`, or null where there is none. */
  third: GroupId | null;
}

/**
 * Who finished where, or null while there is no bracket.
 *
 * Read off the tree rather than off `group.status`, because the three places
 * are decided by three different matches and only the nodes remember which:
 * second place is the participant who *lost* the final, and third is the one
 * who won a match they were only in because they lost the one before it.
 *
 * Each place is null until its own match is decided, so the ceremony (#27) can
 * put a podium up while the third-place match is still being played.
 */
export function finalStandings(tournament: Tournament): FinalStandings | null {
  const bracket = tournament.bracket;
  if (bracket === null) {
    return null;
  }

  const final = bracket.nodes.find((node) => node.round === 'FINAL');
  const third =
    bracket.thirdPlaceNodeId === null ? undefined : findNode(bracket, bracket.thirdPlaceNodeId);

  return {
    first: final?.winnerId ?? null,
    second: final === undefined ? null : loserOf(final),
    third: third?.winnerId ?? null,
  };
}

/**
 * Whether every match of the bracket has been played.
 *
 * The gate in front of the `Siegerehrung` (#27): the third-place match counts,
 * because a podium revealed bronze first cannot be revealed at all until
 * somebody has won bronze (§8).
 */
export function isBracketComplete(tournament: Tournament): boolean {
  const bracket = tournament.bracket;
  const standings = finalStandings(tournament);
  if (bracket === null || standings === null) {
    return false;
  }
  return standings.first !== null && isThirdPlaceSettled(bracket);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Which side of the node above a node's winner lands on. */
type Side = 'A' | 'B';

function nodeIdOf(number: number): BracketNodeId {
  return bracketNodeIdSchema.parse(`${NODE_ID_PREFIX}${number}`);
}

function findNode(bracket: Bracket, id: BracketNodeId): BracketNode | undefined {
  return bracket.nodes.find((node) => node.id === id);
}

/** The group that lost a decided node, or null while it has no result. */
function loserOf(node: BracketNode): GroupId | null {
  if (node.winnerId === null) {
    return null;
  }
  return node.winnerId === node.slotA ? node.slotB : node.slotA;
}

/**
 * The power-of-two field the tree is built for.
 *
 * Clamped rather than trusted: a size smaller than the field it has to hold
 * would drop participants out of the bracket in front of the room, and a
 * bracket of one is not a picture the app can draw (§9 case 10).
 */
function bracketWidth(participants: number, requested: number | undefined): number {
  const wanted = requested === undefined ? participants : Math.max(requested, participants);
  return Math.max(nextPowerOfTwo(wanted), MINIMUM_BRACKET_SIZE);
}

/**
 * The empty tree: every node, its round, and where its winner goes.
 *
 * The order is the one docs/FILE-FORMAT.md writes — the rounds from the first
 * down to the `Halbfinale`, then the `Spiel um Platz 3`, then the `Finale` —
 * and it is the order the ids are handed out along, so `bn_15` is the
 * third-place match of a field of 16 in every file this app writes.
 */
function layOut(size: number): { nodes: BracketNode[]; thirdPlaceNodeId: BracketNodeId | null } {
  const fields: number[] = [];
  for (let field = size; field >= MINIMUM_BRACKET_SIZE; field /= 2) {
    fields.push(field);
  }

  let counter = 0;
  const mint = (): BracketNodeId => {
    counter += 1;
    return nodeIdOf(counter);
  };

  // Every round but the final first, so that the third-place node and the final
  // keep the two numbers the file format gives them.
  const ids = fields.slice(0, -1).map((field) => Array.from({ length: field / 2 }, mint));
  const thirdPlaceNodeId = size >= SEMI_FINAL_FIELD ? mint() : null;
  const finalId = mint();
  ids.push([finalId]);

  const nodes: BracketNode[] = [];
  for (let index = 0; index + 1 < fields.length; index += 1) {
    const round = bracketRoundForSize(fields[index] ?? 0);
    for (const [position, id] of (ids[index] ?? []).entries()) {
      nodes.push({
        id,
        round: round ?? 'FINAL',
        slotA: null,
        slotB: null,
        winnerId: null,
        // Two nodes feed one: the pair at positions 2k and 2k+1 meet in the
        // node above, on side A and side B respectively.
        nextNodeId: ids[index + 1]?.[Math.floor(position / 2)] ?? null,
        tableId: null,
      });
    }
  }

  if (thirdPlaceNodeId !== null) {
    nodes.push(emptyNode(thirdPlaceNodeId, 'THIRD_PLACE'));
  }
  nodes.push(emptyNode(finalId, 'FINAL'));

  return { nodes, thirdPlaceNodeId };
}

function emptyNode(id: BracketNodeId, round: BracketRound): BracketNode {
  return { id, round, slotA: null, slotB: null, winnerId: null, nextNodeId: null, tableId: null };
}

/**
 * Deals the shuffled participants into the first round's slots.
 *
 * The nodes short of a pair are the last ones, which is where §3 already puts
 * the `Freilos` an odd count earns — "the last ones drawn sit this round out"
 * is a sentence the host can say out loud. One per node rather than emptying
 * the tail of the tree: §4's target is always more than half the field, so
 * there are never more `Freilose` than there are nodes to spread them over.
 */
function seedFirstRound(
  nodes: readonly BracketNode[],
  size: number,
  drawn: readonly GroupId[],
): BracketNode[] {
  const first = firstRoundOf(nodes, size);
  const byes = Math.min(Math.max(0, size - drawn.length), first.length);
  const pairs = first.length - byes;

  const seeded = new Map<BracketNodeId, { slotA: GroupId | null; slotB: GroupId | null }>();
  let next = 0;
  for (const [position, node] of first.entries()) {
    const slotA = drawn[next] ?? null;
    next += 1;
    const slotB = position < pairs ? (drawn[next] ?? null) : null;
    if (position < pairs) {
      next += 1;
    }
    seeded.set(node.id, { slotA, slotB });
  }

  return nodes.map((node) => {
    const slots = seeded.get(node.id);
    return slots === undefined ? node : { ...node, ...slots };
  });
}

/**
 * The nodes of the round the field starts in.
 *
 * At a size of two that is the `Finale` itself: two participants are already
 * the final phase, and the one match there is to play is the final
 * (docs/OPEN-QUESTIONS.md #62).
 */
function firstRoundOf(nodes: readonly BracketNode[], size: number): readonly BracketNode[] {
  const round = bracketRoundForSize(size);
  return nodes.filter((node) => node.round === round);
}

/**
 * Decides the `Freilose` the draw itself produced, and advances them.
 *
 * A node with one participant in it has nobody to beat, so it is decided the
 * moment it is drawn and its winner stands in the round above from the start —
 * exactly what `drawRound` does with the bye an odd count earns (§3, §9 case 1).
 */
function settleByes(nodes: readonly BracketNode[]): BracketNode[] {
  let settled = [...nodes];

  for (const node of nodes) {
    if (node.slotA === null || node.slotB !== null || node.winnerId !== null) {
      continue;
    }
    const winnerId = node.slotA;
    settled = settled.map((candidate) =>
      candidate.id === node.id ? { ...candidate, winnerId } : candidate,
    );
    settled = advance(settled, node.id, winnerId);
  }

  return settled;
}

/**
 * Decides the `Spiel um Platz 3` when only one participant can ever reach it.
 *
 * A `Halbfinale` that was itself a `Freilos` produces a winner and no loser, so
 * the third-place match is left with one side that nothing will ever fill. That
 * side is a `Freilos` like any other and the participant standing in the other
 * one has nobody to beat — refusing to decide it would leave the evening one
 * match short of a podium with no way to play it (§7, §9 case 1).
 *
 * Only reachable from the `Freilose` §4's fallback owes a small field
 * (docs/OPEN-QUESTIONS.md #56); an ordinary bracket has two semi-finals with
 * two losers.
 */
function settleThirdPlace(
  nodes: readonly BracketNode[],
  thirdPlaceNodeId: BracketNodeId | null,
): BracketNode[] {
  const third = nodes.find((node) => node.id === thirdPlaceNodeId);
  if (thirdPlaceNodeId === null || third === undefined || third.winnerId !== null) {
    return [...nodes];
  }

  const semis = nodes.filter((node) => node.round === 'SEMI_FINAL');
  // Nothing to say until both semi-finals are over: a slot that is empty now
  // may be filled by the one still being played.
  if (semis.some((node) => node.winnerId === null)) {
    return [...nodes];
  }
  if (semis.filter((node) => node.slotB !== null).length > 1) {
    return [...nodes];
  }

  const only = third.slotA ?? third.slotB;
  if (only === null) {
    return [...nodes];
  }
  return nodes.map((node) => (node.id === thirdPlaceNodeId ? { ...node, winnerId: only } : node));
}

/**
 * Whether the `Spiel um Platz 3` is over, or was never playable at all.
 *
 * The second case is the one a `Freilos` in both semi-finals leaves behind —
 * a shape only a hand-repaired file reaches — and it is answered rather than
 * left open, because a ceremony that could never be triggered is worse than a
 * podium with nobody on the bronze step (§8).
 */
function isThirdPlaceSettled(bracket: Bracket): boolean {
  const third =
    bracket.thirdPlaceNodeId === null ? undefined : findNode(bracket, bracket.thirdPlaceNodeId);
  if (third === undefined || third.winnerId !== null) {
    return true;
  }
  const semis = bracket.nodes.filter((node) => node.round === 'SEMI_FINAL');
  return (
    third.slotA === null &&
    third.slotB === null &&
    semis.length > 0 &&
    semis.every((node) => node.winnerId !== null)
  );
}

/** Puts a node's winner into the node above it, on the side the tree gives it. */
function advance(
  nodes: readonly BracketNode[],
  id: BracketNodeId,
  winnerId: GroupId | null,
): BracketNode[] {
  const node = nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    return [...nodes];
  }
  return place(nodes, node.nextNodeId, sideOf(nodes, id), winnerId);
}

/**
 * Which side of the node above this one feeds.
 *
 * Read off its position among the nodes of its own round rather than stored:
 * the tree alternates, and one derivation cannot drift from the `nextNodeId`
 * links those same positions produced.
 */
function sideOf(nodes: readonly BracketNode[], id: BracketNodeId): Side {
  const node = nodes.find((candidate) => candidate.id === id);
  const siblings = nodes.filter((candidate) => candidate.round === node?.round);
  return siblings.findIndex((candidate) => candidate.id === id) % 2 === 0 ? 'A' : 'B';
}

function place(
  nodes: readonly BracketNode[],
  targetId: BracketNodeId | null,
  side: Side,
  groupId: GroupId | null,
): BracketNode[] {
  return nodes.map((node) => {
    if (node.id !== targetId) {
      return node;
    }
    return side === 'A' ? { ...node, slotA: groupId } : { ...node, slotB: groupId };
  });
}

/**
 * Whether a result has already been played on, in which case correcting it
 * would mean rewriting a match the room has watched.
 */
function isPlayedOn(bracket: Bracket, node: BracketNode): boolean {
  const above = node.nextNodeId === null ? undefined : findNode(bracket, node.nextNodeId);
  if (above !== undefined && above.winnerId !== null) {
    return true;
  }
  if (node.round !== 'SEMI_FINAL' || bracket.thirdPlaceNodeId === null) {
    return false;
  }
  return findNode(bracket, bracket.thirdPlaceNodeId)?.winnerId != null;
}

/**
 * Who is still in after a bracket result.
 *
 * The loser of a `Halbfinale` stays `ACTIVE`: they have another match to play,
 * and a participant marked out who then appears on the projector in the
 * `Spiel um Platz 3` is a contradiction the room can see (§7).
 *
 * The winner is set back to `ACTIVE` as well as the loser to `ELIMINATED`. On a
 * first decision that is a no-op; on a correction it is the whole point,
 * because the group being promoted is the one the previous decision knocked
 * out.
 */
function restatus(
  tournament: Tournament,
  winnerId: GroupId,
  loserId: GroupId,
  playsForThird: boolean,
): Tournament {
  let touched = false;
  const groups = tournament.groups.map((group) => {
    if (group.id !== winnerId && group.id !== loserId) {
      return group;
    }
    const status: GroupStatus = group.id === loserId && !playsForThird ? 'ELIMINATED' : 'ACTIVE';
    if (group.status === status) {
      return group;
    }
    touched = true;
    return { ...group, status };
  });

  return touched ? { ...tournament, groups } : tournament;
}

/**
 * Frees the table a bracket match was played on, if it still carries it.
 *
 * The node keeps its `tableId` — it *was* played there, and that record is what
 * the board and the log read afterwards (docs/OPEN-QUESTIONS.md #37). The
 * `currentMatchId` check is what makes this safe after a correction, when the
 * table may already be carrying the next pair.
 */
function releaseTableOf(tournament: Tournament, node: BracketNode): Tournament {
  if (node.tableId === null) {
    return tournament;
  }
  const table = tournament.tables.find((candidate) => candidate.id === node.tableId);
  if (table === undefined || (table.currentMatchId as string | null) !== node.id) {
    return tournament;
  }
  return releaseTable(tournament, table.id);
}

/**
 * Sends the first round onto the tables that are free, in the host's table
 * order — the rules of §3, applied to the tree.
 *
 * A `Freilos` never takes a table, because nobody plays it, and a `DISABLED`
 * table is not free and is never filled: that is the whole point of taking one
 * out of service.
 */
function fillBracketTables(tournament: Tournament, at: Timestamp): Tournament {
  const bracket = tournament.bracket;
  if (bracket === null) {
    return tournament;
  }

  const free = freeTables(tournament);
  let next = tournament;
  let slot = 0;

  for (const node of queuedBracketNodes(bracket)) {
    const table = free[slot];
    if (table === undefined) {
      // Out of tables. Everything from here on stays queued, in node order.
      break;
    }
    slot += 1;
    next = occupyTable(next, { tableId: table.id, matchId: matchIdSchema.parse(node.id), at });
  }

  return next;
}
