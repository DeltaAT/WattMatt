import { useCallback, useSyncExternalStore } from 'react';

import {
  consolationBlockers,
  consolationField,
  consolationSummary,
  isConsolationOffered,
  type ConsolationBlocker,
  type ConsolationSummary,
} from '@/domain/consolation';
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
import type { Group, Match, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { systemClock } from '@/platform/clock';
import { declineConsolation, startConsolation } from '@/store/actions/consolation';
import { closeRound, drawRound, setMatchWinner, startNextMatch } from '@/store/actions/round';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The `Trostrunde` panel, bound to the one store this window owns (issue #73).
 *
 * The sibling of `useRound`, and deliberately the same shape: the side event is
 * run with the same four decisions the main field is, so it reads the same
 * board out of `@/domain/round` and calls the same actions on the
 * `CONSOLATION` track (docs/TOURNAMENT-RULES.md §10). What it adds is the one
 * question that is only ever asked once — whether the side event happens at
 * all — and the winner it ends with.
 *
 * Like `useRound`, it subscribes to the whole document rather than to the
 * beamer's projection: the panel needs the queue, the decided matches and the
 * standing field, and the snapshot carries only what a scene draws
 * (docs/OPEN-QUESTIONS.md #19).
 */

export interface ConsolationHandle {
  /**
   * Whether the panel has anything to say at all.
   *
   * False for most of an evening: before the `Hoffnungsrunde` closes there is
   * no question to put, and after a host has declined there is nothing to run.
   * A panel explaining that it does not apply is a panel in the way (#21 makes
   * the same argument about the `Hoffnungsrunde`).
   */
  isActive: boolean;
  /** True while the host still has the yes/no question in front of them. */
  isOffered: boolean;
  /** How many would be in it, for the wording of the question. */
  fieldSize: number;
  /** Why the question cannot be put yet — all of them, in a stable order. */
  blockers: readonly ConsolationBlocker[];

  /** The running or finished side event, or null while there is none. */
  summary: ConsolationSummary | null;
  board: RoundBoard | null;
  roundSummary: RoundSummary | null;
  /** For the pairings — the panel resolves ids to what the host calls them. */
  groups: readonly Group[];
  participant: ParticipantLabel;

  drawBlockers: readonly DrawBlocker[];
  canDraw: boolean;
  closeBlockers: readonly CloseRoundBlocker[];
  canClose: boolean;
  undecided: number;
  rematches: ReadonlySet<MatchId>;

  start: () => void;
  decline: () => void;
  previewDraw: () => readonly Match[] | null;
  draw: () => void;
  setWinner: (matchId: MatchId, winnerId: GroupId) => void;
  startNext: (tableId: TableId) => void;
  close: () => void;
  /** Puts the `Trostrunde` board on the projector (`ROUND_BOARD`, issue #19). */
  showOnBeamer: () => void;
}

/** What a window with no tournament open reads: there is no side event. */
const NO_CONSOLATION = {
  isActive: false,
  isOffered: false,
  fieldSize: 0,
  blockers: [],
  summary: null,
  board: null,
  roundSummary: null,
  groups: [],
  participant: 'GROUP',
  drawBlockers: [],
  canDraw: false,
  closeBlockers: [],
  canClose: false,
  undecided: 0,
  rematches: new Set<MatchId>(),
} as const;

export function useConsolation(): ConsolationHandle {
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  const start = useCallback(() => startConsolation(tournamentStore), []);
  const decline = useCallback(() => declineConsolation(tournamentStore), []);
  const draw = useCallback(() => drawRound(tournamentStore, 'CONSOLATION'), []);
  /**
   * Read at click time rather than captured, and thrown away afterwards — the
   * same contract `useRound` documents. The preview runs the real draw against
   * a copy of the document, so what the host is shown is exactly what `draw()`
   * commits: same seed, same cursor, same history (issue #72).
   */
  const previewDraw = useCallback((): readonly Match[] | null => {
    const open = tournamentStore.getState().document;
    if (open === null) {
      return null;
    }
    const preview = previewDrawRound(open, {
      at: systemClock.now(),
      label: (index) => de.consolation.title({ n: index }),
      track: 'CONSOLATION',
    });
    return preview === null ? null : preview.forced;
  }, []);
  const setWinner = useCallback(
    (matchId: MatchId, winnerId: GroupId) => setMatchWinner(tournamentStore, matchId, winnerId),
    [],
  );
  const startNext = useCallback(
    (tableId: TableId) => startNextMatch(tournamentStore, tableId, 'CONSOLATION'),
    [],
  );
  const close = useCallback(() => closeRound(tournamentStore, 'CONSOLATION'), []);
  // Read at click time rather than captured, for the reason `useRound` gives:
  // the scene names the round that is open when the host presses the button.
  const showOnBeamer = useCallback(() => {
    const open = tournamentStore.getState().document;
    const staged = open === null ? null : currentRound(open, 'CONSOLATION');
    if (staged !== null) {
      showScene(tournamentStore, { id: 'ROUND_BOARD', roundId: staged.id });
    }
  }, []);

  const actions = {
    start,
    decline,
    previewDraw,
    draw,
    setWinner,
    startNext,
    close,
    showOnBeamer,
  };

  if (document === null) {
    return { ...NO_CONSOLATION, ...actions };
  }

  const summary = consolationSummary(document);
  const round = summary?.round ?? null;
  const isOffered = isConsolationOffered(document);

  return {
    // Either the question is still open or there is an event to run. A declined
    // one is neither, which is what makes *Nein* worth committing.
    isActive: isOffered || summary !== null,
    isOffered,
    fieldSize: consolationField(document).length,
    blockers: consolationBlockers(document),
    summary,
    // Recomputed on every commit rather than memoised, for the reason
    // `@/domain/lookup` gives: the store commits whole new states, so a cached
    // board would be stale exactly when the host needs it.
    board: round === null ? null : roundBoard(document, round),
    roundSummary: round === null ? null : roundSummary(round),
    groups: document.groups,
    participant: document.settings.participantLabel,
    drawBlockers: drawBlockers(document, 'CONSOLATION'),
    canDraw: canDrawRound(document, 'CONSOLATION'),
    closeBlockers: closeRoundBlockers(document, 'CONSOLATION'),
    canClose: canCloseRound(document, 'CONSOLATION'),
    undecided: round === null ? 0 : undecidedMatches(round).length,
    // The whole tournament's history, not the track's: two groups who met in
    // the qualifying round have met, and drawing them against each other again
    // in the `Trostrunde` is the same repeat it would be anywhere else
    // (issue #72, docs/TOURNAMENT-RULES.md §3).
    rematches: rematchIds(document),
    ...actions,
  };
}
