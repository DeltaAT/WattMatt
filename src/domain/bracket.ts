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
 * **A correction discards what was built on it, and says so first.** Marking
 * the other participant in a `Viertelfinale` that has already been played on
 * clears every result above it and puts those matches back in the queue with
 * the corrected pairings — exactly those, and nothing in the other half of the
 * tree. `bracketCorrection` is the same walk run as a question, so the host
 * reads the list of what is about to be thrown away before they confirm it
 * (issue #26, docs/OPEN-QUESTIONS.md #72). Undo still takes the whole thing
 * back in one press (CLAUDE.md golden rule 6).
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
  if (node.winnerId === winnerId) {
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

  // Everything that was decided *on top of* this result is no longer a result
  // of anything. Cleared here rather than refused above (issue #26): a host who
  // has to reach for undo to fix the quarter-final they misclicked would have
  // to take back every result since, one press at a time, in front of the room.
  // What is discarded is shown to them first — `bracketCorrection` — and this
  // is the same walk that produces that list.
  const invalidated = invalidateAbove(routed, node.id, bracket.thirdPlaceNodeId);

  const withBracket: Tournament = {
    ...tournament,
    bracket: {
      ...bracket,
      nodes: settleThirdPlace(invalidated, bracket.thirdPlaceNodeId),
    },
  };

  return freeTablesOfCleared(restatusBracket(withBracket), bracket, node.id);
}

/** What correcting a decided result would cost (issue #26). */
export interface BracketCorrection {
  /** The node being corrected, as it stands now. */
  node: BracketNode;
  /** The participant the host is about to declare the winner. */
  winnerId: GroupId;
  /**
   * The results that would be discarded, in tree order and as they stand now.
   *
   * Everything built on top of the result being corrected, and nothing else:
   * changing one `Viertelfinale` cannot touch the other three, because the walk
   * only ever climbs the links out of the node it starts at (issue #26's first
   * acceptance criterion).
   */
  discards: readonly BracketNode[];
}

/**
 * What the host is about to lose, or null when they are about to lose nothing.
 *
 * Null is the ordinary case — a first decision, or a correction of the match
 * that has just been played — and it is what tells the panel to skip the
 * confirmation entirely. A dialog in front of every result would be a dialog
 * the host learns to dismiss without reading, which is worse than no dialog at
 * the one moment it matters (docs/OPEN-QUESTIONS.md #72).
 *
 * Computed by running the correction and comparing, rather than by walking the
 * tree a second time: a preview that could disagree with what the button then
 * does is the one thing this must not be.
 */
export function bracketCorrection(
  tournament: Tournament,
  nodeId: BracketNodeId,
  winnerId: GroupId,
): BracketCorrection | null {
  const bracket = tournament.bracket;
  const node = bracket === null ? undefined : findNode(bracket, nodeId);
  if (bracket === null || node === undefined) {
    return null;
  }

  const after = setBracketWinner(tournament, nodeId, winnerId).bracket;
  if (after === null || after === bracket) {
    return null;
  }

  const discards = bracket.nodes.filter(
    (candidate) =>
      candidate.id !== nodeId &&
      candidate.winnerId !== null &&
      findNode(after, candidate.id)?.winnerId === null,
  );

  return discards.length === 0 ? null : { node, winnerId, discards };
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
 * Which side of a node a participant stands on.
 *
 * The tree alternates: the node at an even position of its round feeds side
 * `A` of the node above, the odd one feeds side `B`. Exported because the
 * beamer has to name a single slot — the chip that is about to move is one side
 * of one node (issue #25).
 */
export type BracketSide = 'A' | 'B';

/** How much of the room's attention a round is owed (docs/MOTION.md §4.4). */
export type BracketColumnState =
  /** Every match in it has been played. */
  | 'DECIDED'
  /** Something in it can be played right now — the round the room is watching. */
  | 'ACTIVE'
  /** Still waiting for the round below to send it somebody. */
  | 'FUTURE';

/** One round of the tree, as the projector draws it (issue #25). */
export interface BracketColumn {
  round: BracketRound;
  /** How many participants this round starts with: 16, 8, 4, 2. */
  field: number;
  /** In node order, which is top to bottom on the projector. */
  nodes: readonly BracketNode[];
  state: BracketColumnState;
}

/**
 * The tree by round, in the order it is played and drawn.
 *
 * Derived here rather than in the scene, and taking a `Bracket` rather than a
 * `Tournament`, for the reason `occupancyBoard` gives: the beamer has no
 * tournament — it is handed the bracket in the snapshot — and the host panel
 * (#26) has to arrive at exactly the same columns. One function, two callers,
 * and no way for the projector and the laptop to disagree about which round is
 * the live one (CLAUDE.md golden rule 4).
 *
 * The `Spiel um Platz 3` is a column of its own, in the position the file
 * format gives it: after the semi-finals and before the final. It is *drawn*
 * apart from the tree — §7 calls it "a separate node under the tree" — but as
 * far as this is concerned it is a round like any other, which keeps one rule
 * for the focus level instead of a special case.
 *
 * The state is a local property of a round and never of its position, so the
 * `Finale` and the `Spiel um Platz 3` can both be `ACTIVE` at once — which is
 * exactly what §7 asks for, since they are played at the same time.
 */
export function bracketColumns(bracket: Bracket): readonly BracketColumn[] {
  const columns: BracketColumn[] = [];

  for (const round of columnOrder(bracket)) {
    const nodes = bracket.nodes.filter((node) => node.round === round);
    if (nodes.length === 0) {
      continue;
    }
    columns.push({
      round,
      field: round === 'THIRD_PLACE' ? MINIMUM_BRACKET_SIZE : nodes.length * 2,
      nodes,
      state: columnState(nodes),
    });
  }

  return columns;
}

/**
 * The round the room is watching: the first one with something left to play.
 *
 * What the scene puts in its heading, and null for a bracket that is over — at
 * which point the heading belongs to the `Siegerehrung` rather than to a round
 * nobody is playing.
 */
export function activeBracketRound(bracket: Bracket): BracketRound | null {
  return bracketColumns(bracket).find((column) => column.state === 'ACTIVE')?.round ?? null;
}

/**
 * Where the participant standing in a slot came from — a node and one of its
 * sides — or null when nobody sent them there.
 *
 * This is what lets the projector *move* the chip rather than fade it in
 * (docs/MOTION.md §4.4, issue #25): the audience has to be able to follow a
 * team with their eyes, and to do that the scene has to know which chip already
 * on screen is the same participant one round earlier.
 *
 * Null for the first round, whose participants come from the draw rather than
 * from a match, and for a slot nothing has filled yet.
 *
 * The `Spiel um Platz 3` is the one place where the chip that travels is the
 * *loser* of the round below. That is the whole rule of §7, and a scene that
 * assumed winners would fly the wrong two chips into it.
 */
export function chipOrigin(
  bracket: Bracket,
  nodeId: BracketNodeId,
  side: BracketSide,
): { nodeId: BracketNodeId; side: BracketSide } | null {
  const target = findNode(bracket, nodeId);
  if (target === undefined || slotOf(target, side) === null) {
    return null;
  }

  const feeder = feederOf(bracket, target, side);
  if (feeder === undefined || feeder.winnerId === null) {
    return null;
  }

  const travels = target.round === 'THIRD_PLACE' ? loserOf(feeder) : feeder.winnerId;
  if (travels === null || travels !== slotOf(target, side)) {
    return null;
  }
  return { nodeId: feeder.id, side: feeder.slotA === travels ? 'A' : 'B' };
}

/**
 * Where one match of the tree stands, in the words the host panel sorts by
 * (issue #26).
 *
 * The same five states a match of a round can be in, read off the node instead
 * of off a `status` field — a node has none, and deriving it is what keeps the
 * host panel and the projector from disagreeing about which matches can be
 * played right now (the issue's second acceptance criterion).
 */
export type BracketNodeState =
  /** A `Freilos`: decided by the draw, with nobody on the other side (§9 case 1). */
  | 'BYE'
  /** Played. */
  | 'DECIDED'
  /** On a table, being played now. */
  | 'RUNNING'
  /** Both participants are in and it is waiting for a table (§3). */
  | 'QUEUED'
  /** Still waiting for the round below to send somebody up. */
  | 'WAITING';

export function bracketNodeState(node: BracketNode): BracketNodeState {
  if (node.winnerId !== null) {
    return node.slotA === null || node.slotB === null ? 'BYE' : 'DECIDED';
  }
  if (node.slotA === null || node.slotB === null) {
    return 'WAITING';
  }
  return node.tableId === null ? 'QUEUED' : 'RUNNING';
}

/**
 * Whether the host may end the final phase — *Finale abschließen* (issue #26).
 *
 * The transition `BRACKET → CEREMONY` of §1, gated on the tree actually being
 * over. It lives here rather than in `phaseStep` for the reason the bracket
 * draw does (docs/OPEN-QUESTIONS.md #65, #73): the phase panel offers one
 * generic step, and a second button for the same transition would be a second
 * set of reasons for it to be greyed out — the host presses this one where the
 * final is, under the match they have just decided.
 */
export function canFinishBracket(tournament: Tournament): boolean {
  return tournament.phase === 'BRACKET' && isBracketComplete(tournament);
}

/**
 * Ends the final phase and moves to the `Siegerehrung`
 * (docs/TOURNAMENT-RULES.md §1, §8).
 *
 * The phase and nothing else. §8 is explicit that the podium is revealed by the
 * host and "must never fire automatically the instant the final is decided,
 * because the host may still be talking" — so this does not stage a scene, and
 * the beamer keeps showing the finished tree until somebody says otherwise.
 */
export function finishBracket(tournament: Tournament): Tournament {
  if (!canFinishBracket(tournament)) {
    return tournament;
  }
  return { ...tournament, phase: 'CEREMONY' };
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
type Side = BracketSide;

/**
 * The rounds this bracket has, in the order they are drawn and numbered.
 *
 * Read off the nodes rather than computed from the size, so a file repaired by
 * hand is drawn as the tree it actually contains rather than as the tree its
 * `size` claims.
 */
function columnOrder(bracket: Bracket): readonly BracketRound[] {
  const seen: BracketRound[] = [];
  for (const node of bracket.nodes) {
    if (!seen.includes(node.round)) {
      seen.push(node.round);
    }
  }
  return seen;
}

/**
 * How much attention a round is owed, from its own nodes and nothing else.
 *
 * A round with a match that could be played right now is the live one, whatever
 * the rounds around it are doing. Deliberately not "the earliest undecided
 * round": that would leave the `Finale` in the future while the
 * `Spiel um Platz 3` beside it was being played, and the two are played
 * together (§7).
 */
function columnState(nodes: readonly BracketNode[]): BracketColumnState {
  if (nodes.every((node) => node.winnerId !== null)) {
    return 'DECIDED';
  }
  return nodes.some(isReady) ? 'ACTIVE' : 'FUTURE';
}

/** Both participants are in and nobody has won — a match that can be played. */
function isReady(node: BracketNode): boolean {
  return node.slotA !== null && node.slotB !== null && node.winnerId === null;
}

function slotOf(node: BracketNode, side: Side): GroupId | null {
  return side === 'A' ? node.slotA : node.slotB;
}

/**
 * The node whose result fills one side of another node.
 *
 * For the tree that is the node below feeding it; for the `Spiel um Platz 3` it
 * is the semi-final on the same side, because §7 fills that match from the two
 * semi-finals in their own order.
 */
function feederOf(bracket: Bracket, target: BracketNode, side: Side): BracketNode | undefined {
  const candidates =
    target.round === 'THIRD_PLACE'
      ? bracket.nodes.filter((node) => node.round === 'SEMI_FINAL')
      : bracket.nodes.filter((node) => node.nextNodeId === target.id);

  return candidates.find((node) => sideOf(bracket.nodes, node.id) === side);
}

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
 * Clears everything that was decided on top of a result, and the tables those
 * matches were on (issue #26).
 *
 * The walk only ever climbs the links *out of* the node it starts at — the node
 * above, and the `Spiel um Platz 3` when the node is a semi-final — so the
 * other half of the tree cannot be touched however deep it goes. That is the
 * issue's first acceptance criterion, stated as an algorithm rather than as a
 * promise.
 *
 * A cleared node also loses the table it was played on: the pairing standing in
 * it is not the pairing that was played, so it goes back into the queue for the
 * host to put somewhere (docs/TOURNAMENT-RULES.md §3).
 */
function invalidateAbove(
  nodes: readonly BracketNode[],
  fromId: BracketNodeId,
  thirdPlaceNodeId: BracketNodeId | null,
): BracketNode[] {
  const from = nodes.find((candidate) => candidate.id === fromId);
  if (from === undefined) {
    return [...nodes];
  }

  const targets = [from.nextNodeId, from.round === 'SEMI_FINAL' ? thirdPlaceNodeId : null].filter(
    (id): id is BracketNodeId => id !== null,
  );

  let next = [...nodes];
  for (const target of targets) {
    next = invalidateNode(next, target, thirdPlaceNodeId);
  }
  return next;
}

function invalidateNode(
  nodes: readonly BracketNode[],
  id: BracketNodeId,
  thirdPlaceNodeId: BracketNodeId | null,
): BracketNode[] {
  const node = nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    return [...nodes];
  }

  const cleared = nodes.map((candidate) =>
    candidate.id === id ? { ...candidate, winnerId: null, tableId: null } : candidate,
  );

  if (node.winnerId === null) {
    // Nothing was built on this one, so nothing above it changes. Its table
    // still goes: the pair standing at it is no longer the pair that was sent
    // there, and the room can see that at the table itself.
    return node.tableId === null ? [...nodes] : cleared;
  }

  // Its winner is no longer in the round above, and — from a `Halbfinale` — its
  // loser is no longer in the `Spiel um Platz 3`.
  let next = place(cleared, node.nextNodeId, sideOf(cleared, id), null);
  if (node.round === 'SEMI_FINAL' && thirdPlaceNodeId !== null) {
    next = place(next, thirdPlaceNodeId, sideOf(next, id), null);
  }
  return invalidateAbove(next, id, thirdPlaceNodeId);
}

/**
 * Who is still in, read off the whole tree rather than off the one result that
 * just changed.
 *
 * Recomputed rather than flipped, because a correction can discard a dozen
 * results at once (issue #26) and every participant they knocked out is back in
 * the tournament. One rule covers all of it, and it is the rule every earlier
 * phase already follows: **a participant is out when they have lost and have
 * nowhere left to play.** The loser of a `Halbfinale` is the one exception the
 * rules name — they are routed into the `Spiel um Platz 3` (§7).
 *
 * Only participants the bracket names are touched. Somebody knocked out in the
 * qualifying round was never in this arithmetic and must stay knocked out.
 */
function restatusBracket(tournament: Tournament): Tournament {
  const bracket = tournament.bracket;
  if (bracket === null) {
    return tournament;
  }

  const drawn = new Set<GroupId>();
  const out = new Set<GroupId>();
  for (const node of bracket.nodes) {
    for (const slot of [node.slotA, node.slotB]) {
      if (slot !== null) {
        drawn.add(slot);
      }
    }
    const loser = loserOf(node);
    if (loser === null || (node.round === 'SEMI_FINAL' && bracket.thirdPlaceNodeId !== null)) {
      continue;
    }
    out.add(loser);
  }

  let touched = false;
  const groups = tournament.groups.map((group) => {
    if (!drawn.has(group.id)) {
      return group;
    }
    const status: GroupStatus = out.has(group.id) ? 'ELIMINATED' : 'ACTIVE';
    if (group.status === status) {
      return group;
    }
    touched = true;
    return { ...group, status };
  });

  return touched ? { ...tournament, groups } : tournament;
}

/**
 * Frees every table a correction took a match off.
 *
 * The corrected node's own table, because marking a winner ends the match on it
 * (§3), and the table of every node whose result the correction discarded — a
 * table that kept pointing at a match nobody will finish is one the host would
 * have to delete and re-create mid-event to get back.
 */
function freeTablesOfCleared(
  tournament: Tournament,
  before: Bracket,
  correctedId: BracketNodeId,
): Tournament {
  let next = tournament;

  for (const node of before.nodes) {
    if (node.tableId === null) {
      continue;
    }
    const now = next.bracket?.nodes.find((candidate) => candidate.id === node.id);
    if (node.id === correctedId || now?.tableId === null) {
      next = releaseTableOf(next, node);
    }
  }

  return next;
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
