// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bracketColumns, bracketCorrection, drawBracket, setBracketWinner } from '@/domain/bracket';
import type { BracketNodeId, GroupId, TableId } from '@/domain/ids';
import { freeTables } from '@/domain/selectors';
import {
  bracketNodeId,
  FIXED_NOW,
  group,
  groupId,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import type { Bracket, BracketNode, BracketRound, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { BracketPanel } from '@/windows/host/BracketPanel';

/**
 * The bracket control (issue #26).
 *
 * The rules are tested in `@/domain/bracket`; what is checked here is what the
 * host actually experiences, which is what the acceptance criteria are written
 * in terms of: which matches can be played right now is readable at a glance,
 * a correction that costs results says exactly which ones before it happens,
 * and the third-place match is a peer of the final rather than buried under it.
 */

afterEach(cleanup);

/** A tournament in `NAMING`, everybody named, ready for the draw. */
function readyToDraw(size: number, tables = 2): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: Array.from({ length: size }, (_unused, index) =>
      group(index + 1, { name: `Team ${index + 1}` }),
    ),
    nextGroupNumber: size + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });
}

function drawn(size: number, tables = 2): Tournament {
  return drawBracket(readyToDraw(size, tables), { at: FIXED_NOW });
}

function bracketOf(document: Tournament): Bracket {
  const bracket = document.bracket;
  if (bracket === null) {
    throw new Error('no bracket');
  }
  return bracket;
}

interface PanelHandlers {
  onPreviewDraw?: () => readonly BracketNode[];
  onDraw?: () => void;
  onSetWinner?: (nodeId: BracketNodeId, winnerId: GroupId) => void;
  onAssign?: (nodeId: BracketNodeId, tableId: TableId) => void;
  onFinish?: () => void;
  onFocus?: (round: BracketRound | null) => void;
}

const NOTHING = () => undefined;

function panel(
  document: Tournament,
  handlers: PanelHandlers = {},
  focus: BracketRound | null = null,
  overrides: Partial<Parameters<typeof BracketPanel>[0]> = {},
) {
  const bracket = document.bracket;

  return render(
    <BracketPanel
      bracket={bracket}
      columns={bracket === null ? [] : bracketColumns(bracket)}
      groups={document.groups}
      participant={document.settings.participantLabel}
      freeTables={freeTables(document)}
      tables={document.tables}
      playable={0}
      field={document.groups.length}
      now={FIXED_NOW}
      drawBlockers={[]}
      canDraw
      canFinish={false}
      focus={focus}
      // Nothing to confirm by default: the engine keeps old opponents apart, so
      // an ordinary tree previews no forced rematch at all (issue #72).
      onPreviewDraw={handlers.onPreviewDraw ?? (() => [])}
      onDraw={handlers.onDraw ?? NOTHING}
      onSetWinner={handlers.onSetWinner ?? NOTHING}
      // The real thing rather than a stub: what the dialog lists is exactly what
      // the domain would discard, and a test that faked it would be checking
      // the fake.
      correctionFor={(nodeId, winnerId) => bracketCorrection(document, nodeId, winnerId)}
      onAssign={handlers.onAssign ?? NOTHING}
      onFinish={handlers.onFinish ?? NOTHING}
      onFocus={handlers.onFocus ?? NOTHING}
      {...overrides}
    />,
  );
}

describe('the bracket panel before the tree exists', () => {
  it('offers the draw, and says why when it is refused', () => {
    render(
      <BracketPanel
        bracket={null}
        columns={[]}
        groups={[]}
        participant="GROUP"
        freeTables={[]}
        tables={[]}
        playable={0}
        field={6}
        now={FIXED_NOW}
        drawBlockers={['FIELD_NOT_POWER_OF_TWO']}
        canDraw={false}
        canFinish={false}
        focus={null}
        onPreviewDraw={() => []}
        onDraw={() => undefined}
        onSetWinner={() => undefined}
        correctionFor={() => null}
        onAssign={() => undefined}
        onFinish={() => undefined}
        onFocus={() => undefined}
      />,
    );

    const draw = screen.getByRole('button', { name: /Turnierbaum/ });
    expect(draw.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(de.bracket.blocker.fieldNotPowerOfTwo({ n: 6 }))).toBeTruthy();
  });

  it('draws the tree when the host presses the button', () => {
    const onDraw = vi.fn();
    panel(readyToDraw(4), { onDraw });

    fireEvent.click(screen.getByText(de.bracket.draw));

    expect(onDraw).toHaveBeenCalledOnce();
  });

  it('asks first when the tree would repeat a pairing (issue #72)', () => {
    // Only reachable when the field has played itself out, and then §3 says
    // the host confirms before the room sees it. Never silently.
    const onDraw = vi.fn();
    const forced: BracketNode[] = [
      {
        id: bracketNodeId(1),
        round: 'SEMI_FINAL',
        slotA: groupId(1),
        slotB: groupId(2),
        winnerId: null,
        nextNodeId: null,
        tableId: null,
      },
    ];
    panel(readyToDraw(4), { onDraw, onPreviewDraw: () => forced });

    fireEvent.click(screen.getByText(de.bracket.draw));

    expect(window.document.querySelector('[data-dialog="rematch"]')).not.toBeNull();
    expect(onDraw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: de.draw.rematch.confirm }));

    expect(onDraw).toHaveBeenCalledOnce();
    expect(window.document.querySelector('[data-dialog="rematch"]')).toBeNull();
  });
});

describe('the bracket panel', () => {
  it('lays the tree out by round, with the third-place match beside the final', () => {
    const { container } = panel(drawn(4));
    const columns = [...container.querySelectorAll('[data-bracket-column]')].map((element) =>
      element.getAttribute('data-bracket-column'),
    );

    // §7 puts the `Spiel um Platz 3` beside the `Finale`, and so does the panel.
    expect(columns).toEqual(['SEMI_FINAL', 'THIRD_PLACE', 'FINAL']);
  });

  it('says what each match is doing, so the playable ones stand out', () => {
    const { container } = panel(drawn(4));
    const states = [...container.querySelectorAll('[data-bracket-node]')].map((element) =>
      element.getAttribute('data-node-state'),
    );

    // Two semi-finals on two tables; the final and the third-place match are
    // waiting for them.
    expect(states).toEqual(['RUNNING', 'RUNNING', 'WAITING', 'WAITING']);
    expect(screen.getAllByText(de.bracket.state.WAITING)).toHaveLength(2);
  });

  it('decides an open match with one click', () => {
    const onSetWinner = vi.fn();
    const document = drawn(4);
    const semi = bracketOf(document).nodes[0];
    panel(document, { onSetWinner });

    const target = screen.getAllByRole('button', {
      name: de.match.winnerAction({
        participant: document.groups.find((candidate) => candidate.id === semi?.slotA)?.name ?? '',
      }),
    })[0];
    fireEvent.click(target as HTMLElement);

    expect(onSetWinner).toHaveBeenCalledWith(semi?.id, semi?.slotA);
  });

  /*
   * A decided card keeps its targets hidden until the host opens it, so the
   * stray click that lands on a finished match cannot flip a result the room
   * has already been told.
   */
  it('hides the targets of a decided match until it is armed', () => {
    const document = decidedSemi();
    const { container } = panel(document);
    const card = container.querySelector('[data-node-state="DECIDED"]');

    expect(card?.querySelector('[data-node-action="winner"]')).toBeNull();

    fireEvent.click(card?.querySelector('[data-node-action="correct"]') as HTMLElement);

    expect(
      container.querySelector('[data-node-state="DECIDED"] [data-node-action="winner"]'),
    ).not.toBeNull();
  });

  it('sends a waiting match to the table the host picked', () => {
    const onAssign = vi.fn();
    // Four participants on one table, and a second table brought out after the
    // draw: the queued semi-final now has somewhere to go.
    const drawnOnOne = drawn(4, 1);
    const document = { ...drawnOnOne, tables: [...drawnOnOne.tables, table(2)] };
    const { container } = panel(document, { onAssign });
    const queued = container.querySelector('[data-node-state="QUEUED"]');

    fireEvent.click(queued?.querySelector('[data-node-action="assign"]') as HTMLElement);

    expect(onAssign).toHaveBeenCalledWith(bracketOf(document).nodes[1]?.id, tableId(2));
  });

  it('zooms the projector to a round', () => {
    const onFocus = vi.fn();
    panel(drawn(4), { onFocus });

    fireEvent.click(screen.getByText(de.bracket.focusRound({ round: de.bracket.round.FINAL })));

    expect(onFocus).toHaveBeenCalledWith('FINAL');
  });

  it('does not offer to zoom to the third-place match', () => {
    panel(drawn(4));

    expect(
      screen.queryByText(de.bracket.focusRound({ round: de.bracket.round.THIRD_PLACE })),
    ).toBeNull();
  });
});

describe('correcting a decided match', () => {
  it('goes through without a dialog while nothing was built on it', () => {
    const onSetWinner = vi.fn();
    const document = decidedSemi();
    const { container } = panel(document, { onSetWinner });
    const card = container.querySelector('[data-node-state="DECIDED"]');
    fireEvent.click(card?.querySelector('[data-node-action="correct"]') as HTMLElement);

    fireEvent.click(
      container.querySelectorAll(
        '[data-node-state="DECIDED"] [data-node-action="winner"]',
      )[1] as HTMLElement,
    );

    expect(container.querySelector('[data-dialog="bracket-correction"]')).toBeNull();
    expect(onSetWinner).toHaveBeenCalledOnce();
  });

  it('lists every result it would discard, and waits for an answer', () => {
    const onSetWinner = vi.fn();
    const document = playedOut();
    const { container } = panel(document, { onSetWinner });
    const semi = container.querySelector('[data-bracket-node="bn_1"]');
    fireEvent.click(semi?.querySelector('[data-node-action="correct"]') as HTMLElement);

    fireEvent.click(
      container.querySelectorAll(
        '[data-bracket-node="bn_1"] [data-node-action="winner"]',
      )[1] as HTMLElement,
    );

    // Nothing has happened yet — the host has been asked first.
    expect(onSetWinner).not.toHaveBeenCalled();
    const dialog = container.querySelector('[data-dialog="bracket-correction"]');
    expect(dialog).not.toBeNull();
    // The final and the third-place match were both built on that semi-final.
    expect(dialog?.querySelectorAll('[data-discard-node]')).toHaveLength(2);
    expect(dialog?.textContent).toContain(de.bracket.round.FINAL);
    expect(dialog?.textContent).toContain(de.bracket.round.THIRD_PLACE);
  });

  it('does nothing at all when the host says no', () => {
    const onSetWinner = vi.fn();
    const { container } = panel(playedOut(), { onSetWinner });
    openCorrection(container);

    fireEvent.click(container.querySelector('[data-dialog-action="cancel"]') as HTMLElement);

    expect(onSetWinner).not.toHaveBeenCalled();
    expect(container.querySelector('[data-dialog="bracket-correction"]')).toBeNull();
  });

  it('commits the correction when the host confirms it', () => {
    const onSetWinner = vi.fn();
    const document = playedOut();
    const { container } = panel(document, { onSetWinner });
    openCorrection(container);

    fireEvent.click(container.querySelector('[data-dialog-action="confirm"]') as HTMLElement);

    const semi = bracketOf(document).nodes[0];
    const loser = semi?.winnerId === semi?.slotA ? semi?.slotB : semi?.slotA;
    expect(onSetWinner).toHaveBeenCalledWith(semi?.id, loser);
    expect(container.querySelector('[data-dialog="bracket-correction"]')).toBeNull();
  });
});

/** A bracket of four with one semi-final decided and nothing built on it. */
function decidedSemi(): Tournament {
  const document = drawn(4);
  const semi = bracketOf(document).nodes[0];
  return setBracketWinner(document, semi?.id as BracketNodeId, semi?.slotA as GroupId);
}

/** A bracket of four played to the end — every result built on the semi-finals. */
function playedOut(): Tournament {
  let document = drawn(4);
  for (const node of bracketOf(document).nodes.filter((node) => node.round === 'SEMI_FINAL')) {
    document = setBracketWinner(document, node.id, node.slotA as GroupId);
  }
  const final = bracketOf(document).nodes.find((node) => node.round === 'FINAL');
  const third = bracketOf(document).nodes.find((node) => node.round === 'THIRD_PLACE');
  document = setBracketWinner(document, final?.id as BracketNodeId, final?.slotA as GroupId);
  return setBracketWinner(document, third?.id as BracketNodeId, third?.slotA as GroupId);
}

/** Arms the first semi-final and aims at the other participant. */
function openCorrection(container: HTMLElement): void {
  const semi = container.querySelector('[data-bracket-node="bn_1"]');
  fireEvent.click(semi?.querySelector('[data-node-action="correct"]') as HTMLElement);
  fireEvent.click(
    container.querySelectorAll(
      '[data-bracket-node="bn_1"] [data-node-action="winner"]',
    )[1] as HTMLElement,
  );
}

/*
 * The `Trostrunde` ends in the same tree — same nodes, same third-place
 * routing, same corrections — drawn in numbers rather than names (issue #91,
 * docs/TOURNAMENT-RULES.md §10). Both can be on screen at once, so the panel
 * says which tournament it belongs to and what its last button actually does.
 */
describe('the side event’s own tree', () => {
  it('names the tournament the tree belongs to', () => {
    panel(readyToDraw(8), {}, null, { track: 'CONSOLATION' });

    expect(screen.getByRole('region', { name: de.consolation.bracketLabel })).toBeTruthy();
    expect(screen.getByText(de.consolation.bracketLabel)).toBeTruthy();
  });

  /*
   * The same press means two different things: on the main field it opens the
   * `Siegerehrung`, and here it is the last step the side event takes at all —
   * the podium is the main tournament's 1/2/3 and nobody else's.
   */
  it('says that closing this tree ends the side event', () => {
    panel(drawn(4), {}, null, { track: 'CONSOLATION', canFinish: true });

    expect(screen.getByText(de.consolation.bracketFinish)).toBeTruthy();
    expect(screen.queryByText(de.bracket.finish)).toBeNull();
  });

  it('leaves the main field’s panel exactly as it was', () => {
    panel(drawn(4), {}, null, { canFinish: true });

    expect(screen.getByRole('region', { name: de.bracket.sectionLabel })).toBeTruthy();
    expect(screen.getByText(de.bracket.finish)).toBeTruthy();
  });
});
