import { useCallback, useSyncExternalStore } from 'react';

import type { BeamerScene } from '@/domain/beamerScene';
import {
  bracketBlockers,
  bracketColumns,
  bracketCorrection,
  bracketNodeState,
  canDrawBracket,
  canFinishBracket,
  type BracketBlocker,
  type BracketColumn,
  type BracketCorrection,
} from '@/domain/bracket';
import { fieldSize, FINAL_PHASE_SIZE } from '@/domain/draw';
import type { BracketNodeId, GroupId, TableId } from '@/domain/ids';
import { freeTables } from '@/domain/selectors';
import type { Bracket, BracketRound, Group, ParticipantLabel, Table } from '@/domain/types';
import {
  assignBracketMatch,
  drawBracket,
  finishBracket,
  setBracketWinner,
  showBracketOnBeamer,
} from '@/store/actions/bracket';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The bracket control panel, bound to the one store this window owns
 * (issue #26).
 *
 * The same shape as `useRound`, and for the same reasons: everything that
 * decides anything is in `@/domain/bracket` and the actions around it, and what
 * is left here is React — subscribing so the tree redraws when a result lands,
 * and handing the panel callbacks that keep their identity between renders.
 *
 * Two things are read at click time rather than captured. The **correction
 * preview** is a question about the tournament as it stands the moment the host
 * aims at a participant, and a stale answer would list the wrong matches in the
 * confirmation. The **zoom** is the same: it is written into the staged scene,
 * so it has to be read back off the store rather than kept beside it, or the
 * panel and the projector would disagree about where the beamer is pointed
 * (CLAUDE.md golden rule 4).
 */

export interface BracketHandle {
  /**
   * Whether the panel belongs on screen at all.
   *
   * From the naming phase on: the host needs the button that draws the tree
   * before there is a tree, and the finished tree stays readable through the
   * `Siegerehrung`.
   */
  isActive: boolean;
  bracket: Bracket | null;
  /** The tree by round, exactly as the projector groups it (issue #25). */
  columns: readonly BracketColumn[];
  groups: readonly Group[];
  participant: ParticipantLabel;
  /** The tables a waiting match could be sent to, in the host's order. */
  freeTables: readonly Table[];
  /** How many matches could be played right now — the panel's headline count. */
  playable: number;
  /** How many are in the final phase, for the reason a blocked draw gives. */
  field: number;

  drawBlockers: readonly BracketBlocker[];
  canDraw: boolean;
  canFinish: boolean;
  /** Which round the projector is zoomed to, or null for the whole tree. */
  focus: BracketRound | null;

  draw: () => void;
  setWinner: (nodeId: BracketNodeId, winnerId: GroupId) => void;
  /**
   * What marking this participant would throw away, or null when it would throw
   * away nothing. The panel asks before every correction and only stops the
   * host when the answer is not null.
   */
  correctionFor: (nodeId: BracketNodeId, winnerId: GroupId) => BracketCorrection | null;
  assign: (nodeId: BracketNodeId, tableId: TableId) => void;
  finish: () => void;
  /** Points the projector at the tree, zoomed to a round or to the whole of it. */
  showOnBeamer: (focus: BracketRound | null) => void;
  /**
   * Stages the `Siegerehrung` (issue #27), either revealing itself or waiting
   * for the host to step through the podium.
   */
  showCeremony: (mode: 'AUTO' | 'STEP', step?: number) => void;
  /** Moves the stepped ceremony on to the next place. */
  showCeremonyStep: (step: number) => void;
}

/** What a window with no tournament open reads: there is no bracket. */
const NO_BRACKET = {
  isActive: false,
  bracket: null,
  columns: [],
  groups: [],
  participant: 'GROUP',
  freeTables: [],
  playable: 0,
  field: 0,
  drawBlockers: [],
  canDraw: false,
  canFinish: false,
  focus: null,
} as const;

export function useBracket(): BracketHandle {
  const state = useSyncExternalStore(tournamentStore.subscribe, () => tournamentStore.getState());

  const draw = useCallback(() => {
    drawBracket(tournamentStore);
  }, []);
  const setWinner = useCallback((nodeId: BracketNodeId, winnerId: GroupId) => {
    setBracketWinner(tournamentStore, nodeId, winnerId);
  }, []);
  const correctionFor = useCallback((nodeId: BracketNodeId, winnerId: GroupId) => {
    const open = tournamentStore.getState().document;
    return open === null ? null : bracketCorrection(open, nodeId, winnerId);
  }, []);
  const assign = useCallback((nodeId: BracketNodeId, tableId: TableId) => {
    assignBracketMatch(tournamentStore, nodeId, tableId);
  }, []);
  const finish = useCallback(() => {
    finishBracket(tournamentStore);
  }, []);
  const showOnBeamer = useCallback((focus: BracketRound | null) => {
    showBracketOnBeamer(tournamentStore, focus);
  }, []);

  const showCeremony = useCallback((mode: 'AUTO' | 'STEP', step = 0) => {
    const scene: BeamerScene = { id: 'CEREMONY', reveal: { mode, step } } as BeamerScene;
    showScene(tournamentStore, scene);
  }, []);

  const showCeremonyStep = useCallback((nextStep: number) => {
    const scene: BeamerScene = {
      id: 'CEREMONY',
      reveal: { mode: 'STEP', step: nextStep },
    } as BeamerScene;
    showScene(tournamentStore, scene);
  }, []);

  const actions = {
    draw,
    setWinner,
    correctionFor,
    assign,
    finish,
    showOnBeamer,
    showCeremony,
    showCeremonyStep,
  };

  const document = state.document;
  if (document === null) {
    return { ...NO_BRACKET, ...actions };
  }

  const bracket = document.bracket;
  const nodes = bracket?.nodes ?? [];

  return {
    isActive: bracket !== null || document.phase === 'NAMING',
    bracket,
    // Recomputed on every commit rather than memoised, for the reason
    // `@/domain/lookup` gives: the store commits whole new states, so a cached
    // tree would be stale exactly when the host needs it.
    columns: bracket === null ? [] : bracketColumns(bracket),
    groups: document.groups,
    participant: document.settings.participantLabel,
    freeTables: freeTables(document),
    playable: nodes.filter((node) => {
      const nodeState = bracketNodeState(node);
      return nodeState === 'QUEUED' || nodeState === 'RUNNING';
    }).length,
    field: fieldSize(document),
    drawBlockers: bracketBlockers(document),
    canDraw: canDrawBracket(document),
    canFinish: canFinishBracket(document),
    focus: state.scene.id === 'BRACKET' ? (state.scene.focus ?? null) : null,
    ...actions,
  };
}

/** The largest bracket §7 names, for the reason a too-large field is refused. */
export const BRACKET_MAX_FIELD = FINAL_PHASE_SIZE;
