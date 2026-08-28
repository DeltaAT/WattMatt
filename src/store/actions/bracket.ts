import type { BeamerScene } from '@/domain/beamerScene';
import * as bracket from '@/domain/bracket';
import type { BracketNodeId, GroupId, TableId } from '@/domain/ids';
import { trackState } from '@/domain/track';
import type { BracketNode, BracketRound, Clock, RoundTrack, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { systemClock } from '@/platform/clock';
import { showScene } from '@/store/actions/scene';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * Everything the host decides in the final phase (issue #24,
 * docs/TOURNAMENT-RULES.md §7).
 *
 * The rules are `@/domain/bracket`'s — this layer adds the German the undo
 * button reads, the audit record the file keeps, and how much a crash in the
 * next half-second is allowed to cost. Each is one commit, so each lands on the
 * undo stack, in the log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3).
 *
 * That single commit is also what makes the third-place match undoable. A
 * `Halbfinale` decides two things at once — who goes to the `Finale` and who
 * goes to the `Spiel um Platz 3` — and both are in the one document this
 * commits, so one press of *Rückgängig* takes back both. Nothing here has to
 * know that, which is the point (CLAUDE.md golden rule 6).
 */

/**
 * Draws the bracket and puts it on the projector, in one commit.
 *
 * One commit, for the reason `drawRound` gives: an undo that took the tree back
 * but left the beamer showing it would be a projector displaying a phase that
 * no longer exists (golden rule 4), and one that took the picture back but left
 * the bracket drawn would have burned the RNG cursor for nothing.
 *
 * The scene is staged whatever `autoFollow` says, and `autoFollow` itself is
 * left alone: the host pressed *Turnierbaum auslosen*, which is as explicit as
 * an intention gets (golden rule 3).
 */
export function drawBracket(
  store: TournamentStore,
  clock: Clock = systemClock,
  track: RoundTrack = 'MAIN',
): void {
  change(
    store,
    (document) => bracket.drawBracket(document, { at: clock.now() }, track),
    (_before, after) => ({
      // A draw is not repeatable: the cursor has moved, so a crash that lost
      // the bracket would deal the room a different tree than the one they
      // watched being drawn (CLAUDE.md golden rule 7).
      urgent: true,
      undoLabel: de.undo.action.bracketDrawn,
      log: {
        action: 'BRACKET_DRAWN',
        payload: {
          track,
          size: trackState(after, track).bracket?.size ?? null,
          // The whole tree, because this is the draw a participant may ask
          // about a week later, and the seed plus the cursor it ran from are
          // what reproduce it (docs/OPEN-QUESTIONS.md #23).
          nodes: trackState(after, track).bracket?.nodes.map((node) => ({
            nodeId: node.id,
            round: node.round,
            slotA: node.slotA,
            slotB: node.slotB,
            tableId: node.tableId,
          })),
          // Empty in every ordinary draw. Non-empty only when the field had
          // played itself out, which is the thing anybody asks about a week
          // later (issue #72, docs/FILE-FORMAT.md rule 6).
          forcedRematches: bracket
            .forcedBracketRematches(after, track)
            .map((node) => ({ nodeId: node.id, slotA: node.slotA, slotB: node.slotB })),
          rngCursor: after.rngCursor,
        },
      },
    }),
    () => ({ scene: bracketScene(null, track) }),
  );
}

/**
 * Marks the winner of a bracket match, which also frees its table, advances the
 * winner and — in the `Halbfinale` — sends the loser to the `Spiel um Platz 3`.
 *
 * The same call corrects a decision, exactly as it does in a round: passing the
 * other group promotes it and puts the previous winner back where it came from.
 * The engine refuses the correction once the result has been played on, which
 * is what makes a click that arrived anyway cost nothing.
 */
export function setBracketWinner(
  store: TournamentStore,
  nodeId: BracketNodeId,
  winnerId: GroupId,
  track: RoundTrack = 'MAIN',
): void {
  change(
    store,
    (document) => bracket.setBracketWinner(document, nodeId, winnerId, track),
    (before, after) => {
      // What the correction replaced. Half an hour later the file is the only
      // record of the result that was on the projector first
      // (docs/FILE-FORMAT.md rule 6).
      const node = nodeOf(before, nodeId, track);
      const previousWinnerId = node?.winnerId ?? null;
      const participant = participantOf(after, winnerId);
      // What this decision threw away, if anything (issue #26). The count is on
      // the undo button because it is the size of what pressing it gives back:
      // a host who discarded the final and the third-place match by correcting
      // a semi is looking for *that* step, not for "Sieger geändert".
      const discarded = bracket.bracketCorrection(before, nodeId, winnerId, track)?.discards ?? [];
      return {
        undoLabel:
          discarded.length > 0
            ? de.undo.action.bracketCorrected({ participant, n: discarded.length })
            : previousWinnerId === null
              ? de.undo.action.matchWinnerSet({ participant })
              : de.undo.action.matchWinnerCorrected({ participant }),
        log: {
          action: 'BRACKET_WINNER_SET',
          payload: {
            track,
            nodeId,
            round: node?.round ?? null,
            winnerId,
            previousWinnerId,
            // Where the loser went. In the semi-finals that is the third-place
            // match rather than out of the tournament (§7), and a log that did
            // not say so would leave the host reconstructing why somebody who
            // had lost was still playing.
            loserId: loserOf(node?.slotA ?? null, node?.slotB ?? null, winnerId),
            thirdPlaceNodeId:
              node?.round === 'SEMI_FINAL'
                ? (trackState(after, track).bracket?.thirdPlaceNodeId ?? null)
                : null,
            // "This situation is logged prominently" applies here as much as it
            // does to the §4 fallback: results the room watched being played
            // have been thrown away, and somebody will ask which.
            discarded: discarded.map((discard) => ({
              nodeId: discard.id,
              round: discard.round,
              winnerId: discard.winnerId,
            })),
          },
        },
      };
    },
  );
}

/**
 * Ends the final phase, once every match of the tree has been played —
 * *Finale abschließen* (issue #26, docs/TOURNAMENT-RULES.md §1).
 *
 * The phase and nothing else. §8 is explicit that the podium is revealed by the
 * host "manually — it must never fire automatically the instant the final is
 * decided, because the host may still be talking", so no scene is staged here:
 * the projector keeps the finished tree until somebody puts the `Siegerehrung`
 * on it (issue #27).
 */
export function finishBracket(store: TournamentStore, track: RoundTrack = 'MAIN'): void {
  change(
    store,
    (document) => bracket.finishBracket(document, track),
    (_before, after) => ({
      // The line the host has told the room they have crossed, and the moment
      // the evening's result is final — the same reason a closed round is
      // urgent (issue #17).
      urgent: true,
      undoLabel: de.undo.action.bracketFinished,
      log: {
        action: 'BRACKET_FINISHED',
        payload: {
          track,
          // The podium, in the file, as of the moment the phase ended: the one
          // record of what the tournament actually produced. For the side event
          // it is the record of what *it* produced, and it stops there: its
          // winner never reaches the `Siegerehrung` (issue #91, §10).
          ...(bracket.finalStandings(after, track) ?? {}),
        },
      },
    }),
  );
}

/**
 * Zooms the projector to one round of the tree, or back to the whole of it
 * (issue #26).
 *
 * A scene change like any other, so it takes the beamer by hand and turns
 * `autoFollow` off (golden rule 3): the host is pointing the room at the two
 * matches that are left, and that decision must not be undone by the next
 * phase change.
 */
export function showBracketOnBeamer(
  store: TournamentStore,
  focus: BracketRound | null,
  track: RoundTrack = 'MAIN',
): void {
  showScene(store, bracketScene(focus, track));
}

/**
 * The host's confirmation that the table which just freed up takes the next
 * waiting bracket match (docs/TOURNAMENT-RULES.md §3, §7).
 *
 * Deliberately not automatic: a final phase where the next pair walks up the
 * moment the last one sits down takes the beamer away from the host
 * mid-sentence (docs/OPEN-QUESTIONS.md #35).
 */
/**
 * Puts one waiting bracket match on a table the host picked (issue #26).
 *
 * Per match rather than only "the next one", unlike a round: the `Finale` and
 * the `Spiel um Platz 3` are playable at the same moment (§7), and which of the
 * two goes on the good table in the middle of the room is exactly the kind of
 * decision the host makes out loud.
 */
export function assignBracketMatch(
  store: TournamentStore,
  nodeId: BracketNodeId,
  tableId: TableId,
  clock: Clock = systemClock,
  track: RoundTrack = 'MAIN',
): void {
  change(
    store,
    (document) => bracket.assignBracketNode(document, { nodeId, tableId, at: clock.now() }, track),
    (_before, after) => ({
      undoLabel: de.undo.action.matchStarted({ table: tableLabel(after, tableId) }),
      log: { action: 'BRACKET_MATCH_ASSIGNED', payload: { tableId, nodeId } },
    }),
  );
}

export function startNextBracketMatch(
  store: TournamentStore,
  tableId: TableId,
  clock: Clock = systemClock,
  track: RoundTrack = 'MAIN',
): void {
  change(
    store,
    (document) => bracket.assignNextBracketNode(document, { tableId, at: clock.now() }, track),
    (before, after) => ({
      undoLabel: de.undo.action.matchStarted({ table: tableLabel(after, tableId) }),
      log: {
        action: 'BRACKET_MATCH_ASSIGNED',
        payload: {
          tableId,
          nodeId: after.tables.find((table) => table.id === tableId)?.currentMatchId ?? null,
          // Read off the tournament from before: afterwards this match is no
          // longer waiting, and how long the queue was is the thing a host
          // reconstructing the evening wants to know.
          queued: (() => {
            const tree = trackState(before, track).bracket;
            return tree === null ? 0 : bracket.queuedBracketNodes(tree).length;
          })(),
        },
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * The same shape as `@/store/actions/round`, and refusing the same two things
 * for the same reasons: nothing to do with no tournament open, and nothing to
 * commit when the domain handed its argument back. Every function in
 * `@/domain/bracket` does that when it is asked for something that cannot
 * happen — a second draw, a winner for a `Freilos`, a correction of a result
 * that has been played on — and committing it would put a step on the undo
 * stack that undoes nothing.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
  picture?: () => { scene?: BeamerScene },
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after, ...picture?.() }), describe(before, after));
}

function nodeOf(
  document: Tournament,
  nodeId: BracketNodeId,
  track: RoundTrack = 'MAIN',
): BracketNode | undefined {
  return trackState(document, track).bracket?.nodes.find((node) => node.id === nodeId);
}

function loserOf(slotA: GroupId | null, slotB: GroupId | null, winnerId: GroupId): GroupId | null {
  if (slotA === null || slotB === null) {
    return null;
  }
  return winnerId === slotA ? slotB : slotA;
}

/** What this tournament calls the group, in the host's chosen wording. */
function participantOf(document: Tournament, groupId: GroupId): string {
  const group = document.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    return de.group.unknown;
  }
  return (
    group.name ?? de.participant[document.settings.participantLabel].numbered({ n: group.number })
  );
}

/** What the host calls this table, for the undo button and the log. */
function tableLabel(document: Tournament, tableId: TableId): string {
  return document.tables.find((table) => table.id === tableId)?.label ?? de.table.label;
}

/**
 * The scene descriptor for one track's tree.
 *
 * `MAIN` carries no `track`, so every picture the host has been staging since
 * issue #26 is the identical object it always was — the same reasoning
 * `repechageScene` follows (issue #91).
 */
function bracketScene(focus: BracketRound | null, track: RoundTrack): BeamerScene {
  if (track === 'MAIN') {
    return focus === null ? { id: 'BRACKET' } : { id: 'BRACKET', focus };
  }
  return focus === null ? { id: 'BRACKET', track } : { id: 'BRACKET', focus, track };
}
