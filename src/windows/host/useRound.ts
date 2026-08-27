import { useCallback, useSyncExternalStore } from 'react';

import {
  canCloseRound,
  canDrawRound,
  closeRoundBlockers,
  drawBlockers,
  previewDrawRound,
  type CloseRoundBlocker,
  type DrawBlocker,
} from '@/domain/draw';
import { rematchIds } from '@/domain/history';
import type { GroupId, MatchId, TableId } from '@/domain/ids';
import { roundBoard, roundSummary, type RoundBoard, type RoundSummary } from '@/domain/round';
import { currentRound, undecidedMatches } from '@/domain/selectors';
import type { Group, Match, ParticipantLabel, Round } from '@/domain/types';
import { de } from '@/i18n';
import { systemClock } from '@/platform/clock';
import { closeRound, drawRound, setMatchWinner, startNextMatch } from '@/store/actions/round';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The round control panel, bound to the one store this window owns (issue #17).
 *
 * Everything that decides anything lives in `@/domain/draw` and the actions
 * around it; everything that is *read* lives in `@/domain/round`. What is left
 * here is React: subscribing so the board redraws when a result lands, and
 * handing the panel callbacks that do not change identity between renders.
 *
 * It subscribes to the whole document rather than to the beamer's projection,
 * unlike `useTables`: the panel needs the queue, the decided matches and the
 * round state, and the snapshot deliberately carries only what a scene draws
 * (docs/OPEN-QUESTIONS.md #19).
 */

export interface RoundHandle {
  /**
   * Whether there is a round phase to show at all.
   *
   * False during `SETUP`, where the panel would be a header over nothing and
   * the host is looking at the pre-start checks instead.
   */
  isActive: boolean;
  /** The round the host is working in, or null between two rounds. */
  round: Round | null;
  board: RoundBoard | null;
  summary: RoundSummary | null;
  /** For the pairings — the panel resolves ids to what the host calls them. */
  groups: readonly Group[];
  participant: ParticipantLabel;
  /** True while any match is on a table: what makes the panel's clock tick. */
  isAnyRunning: boolean;

  drawBlockers: readonly DrawBlocker[];
  canDraw: boolean;
  closeBlockers: readonly CloseRoundBlocker[];
  canClose: boolean;
  /** How many matches still need a winner, for the close button's reason. */
  undecided: number;
  /**
   * The matches of the open round that repeat a meeting the evening already
   * staged, for the badge on their cards (issue #72).
   *
   * Derived from the tournament's own history rather than stored on the match,
   * so it survives an undo, a correction and a file repaired by hand
   * (`@/domain/history`).
   */
  rematches: ReadonlySet<MatchId>;

  /**
   * What the next draw would deal, without dealing it.
   *
   * Null when there is nothing to draw. Otherwise the forced rematches it
   * could not avoid — empty in every ordinary draw, and the one case the host
   * has to confirm before the projector shows it (docs/TOURNAMENT-RULES.md §3).
   */
  previewDraw: () => readonly Match[] | null;
  draw: () => void;
  setWinner: (matchId: MatchId, winnerId: GroupId) => void;
  /** Hands the next waiting pair to a table that has come free. */
  startNext: (tableId: TableId) => void;
  close: () => void;
  /** Puts the round board on the projector (`ROUND_BOARD`, issue #19). */
  showOnBeamer: () => void;
}

/** What a window with no tournament open reads: there is no round. */
const NO_ROUND = {
  isActive: false,
  round: null,
  board: null,
  summary: null,
  groups: [],
  participant: 'GROUP',
  isAnyRunning: false,
  drawBlockers: [],
  canDraw: false,
  closeBlockers: [],
  canClose: false,
  undecided: 0,
  rematches: new Set<MatchId>(),
} as const;

export function useRound(): RoundHandle {
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  const draw = useCallback(() => {
    drawRound(tournamentStore);
  }, []);
  /**
   * Read at click time rather than captured, and thrown away afterwards.
   *
   * The preview runs the real draw against a copy of the document, so what the
   * host is shown is exactly what `draw()` then commits — same seed, same
   * cursor, same history. Nothing is spent by looking (issue #72).
   */
  const previewDraw = useCallback((): readonly Match[] | null => {
    const open = tournamentStore.getState().document;
    if (open === null) {
      return null;
    }
    const preview = previewDrawRound(open, {
      at: systemClock.now(),
      label: (index) => de.round.title({ n: index }),
    });
    return preview === null ? null : preview.forced;
  }, []);
  const setWinner = useCallback(
    (matchId: MatchId, winnerId: GroupId) => setMatchWinner(tournamentStore, matchId, winnerId),
    [],
  );
  const startNext = useCallback((tableId: TableId) => startNextMatch(tournamentStore, tableId), []);
  const close = useCallback(() => closeRound(tournamentStore), []);
  // Read at click time rather than captured: the scene names the round that is
  // open when the host presses the button, and a callback frozen around an
  // earlier one would point the projector at a round that has been closed.
  const showOnBeamer = useCallback(() => {
    const open = tournamentStore.getState().document;
    const staged = open === null ? null : currentRound(open);
    if (staged !== null) {
      showScene(tournamentStore, { id: 'ROUND_BOARD', roundId: staged.id });
    }
  }, []);

  const actions = { previewDraw, draw, setWinner, startNext, close, showOnBeamer };

  if (document === null) {
    return { ...NO_ROUND, ...actions };
  }

  const round = currentRound(document);

  return {
    // Recomputed on every commit rather than memoised, for the reason
    // `@/domain/lookup` gives: the store commits whole new states, so a cached
    // board would be stale exactly when the host needs it.
    isActive: document.phase !== 'SETUP',
    round,
    board: round === null ? null : roundBoard(document, round),
    summary: round === null ? null : roundSummary(round),
    groups: document.groups,
    participant: document.settings.participantLabel,
    isAnyRunning: document.tables.some((table) => table.currentMatchId !== null),
    drawBlockers: drawBlockers(document),
    canDraw: canDrawRound(document),
    closeBlockers: closeRoundBlockers(document),
    canClose: canCloseRound(document),
    undecided: round === null ? 0 : undecidedMatches(round).length,
    rematches: rematchIds(document),
    ...actions,
  };
}
