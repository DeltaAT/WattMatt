// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawRound as drawTheRound } from '@/domain/draw';
import { rematchIds } from '@/domain/history';
import type { MatchId } from '@/domain/ids';
import { roundBoard, roundSummary } from '@/domain/round';
import { currentRound } from '@/domain/selectors';
import { reserveTable } from '@/domain/tables';
import {
  FIXED_NOW,
  group,
  groupId,
  match,
  matchId,
  occupiedTable,
  round,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import type { Match, Round, Timestamp, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { RoundPanel } from '@/windows/host/RoundPanel';

/**
 * The round control panel (issue #17).
 *
 * The rules are tested in `@/domain/draw` and `@/domain/round`; what is checked
 * here is what the host actually experiences, which is what the acceptance
 * criteria are written in terms of: one click decides a match, a decided match
 * does not flip under a stray one, thirty-two matches are all on the screen,
 * and a control that is doing nothing says why in German.
 */

afterEach(cleanup);

/** A qualifying round drawn from the real engine: `groups` on `tables`. */
function drawn(groups: number, tables: number): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });
  return drawTheRound(base, { at: FIXED_NOW, label: (n) => de.round.title({ n }) });
}

const openRound = (document: Tournament): Round => {
  const open = currentRound(document);
  if (open === null) {
    throw new Error('no open round');
  }
  return open;
};

function handlers() {
  return {
    // Nothing to confirm by default: the engine keeps old opponents apart, so
    // an ordinary draw previews no forced rematch at all (issue #72).
    onPreviewDraw: vi.fn(() => [] as readonly Match[]),
    onDraw: vi.fn(),
    onSetWinner: vi.fn(),
    onStartNext: vi.fn(),
    onClose: vi.fn(),
    onShowOnBeamer: vi.fn(),
  };
}

function setup(document: Tournament, now: Timestamp = FIXED_NOW) {
  const spies = handlers();
  const open = currentRound(document);

  render(
    <RoundPanel
      round={open}
      board={open === null ? null : roundBoard(document, open)}
      summary={open === null ? null : roundSummary(open)}
      groups={document.groups}
      participant={document.settings.participantLabel}
      now={now}
      drawBlockers={open === null ? [] : ['ROUND_OPEN']}
      canDraw={open === null}
      closeBlockers={
        open === null || open.matches.some((each) => each.winnerId === null)
          ? ['MATCHES_UNDECIDED']
          : []
      }
      canClose={open !== null && open.matches.every((each) => each.winnerId !== null)}
      undecided={open === null ? 0 : open.matches.filter((each) => each.winnerId === null).length}
      rematches={rematchIds(document)}
      {...spies}
    />,
  );

  return spies;
}

/** The card of one match. */
function card(id: MatchId): HTMLElement {
  const element = document.querySelector(`[data-match-id="${id}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no card for ${id}`);
  }
  return element;
}

const buttonsIn = (parent: HTMLElement, selector: string): HTMLElement[] =>
  [...parent.querySelectorAll(selector)].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );

const clickIn = (parent: HTMLElement, selector: string) => {
  const button = buttonsIn(parent, selector)[0];
  if (button === undefined) {
    throw new Error(`no control matching ${selector}`);
  }
  fireEvent.click(button);
};

describe('a draw with forced rematches (issue #72)', () => {
  /**
   * A closed round plus a fresh panel over it, with the preview answering
   * whatever the case needs.
   *
   * The forced pairs are handed in rather than produced by a real draw: what
   * this file tests is the host's experience of them, and the engine that
   * decides whether they exist is tested in `@/domain/pairing`.
   */
  function panel(forced: readonly Match[]) {
    const document = tournament({
      phase: 'ELIMINATION',
      groups: [group(1), group(2), group(3), group(4)],
      nextGroupNumber: 5,
      tables: [table(1), table(2)],
      nextTableNumber: 3,
    });
    const spies = { ...handlers(), onPreviewDraw: vi.fn(() => forced) };

    render(
      <RoundPanel
        round={null}
        board={null}
        summary={null}
        groups={document.groups}
        participant={document.settings.participantLabel}
        now={FIXED_NOW}
        drawBlockers={[]}
        canDraw
        closeBlockers={['NO_OPEN_ROUND']}
        canClose={false}
        undecided={0}
        rematches={new Set<MatchId>()}
        {...spies}
      />,
    );

    return spies;
  }

  const pressDraw = () => {
    fireEvent.click(screen.getByRole('button', { name: de.draw.start }));
  };

  const dialog = () => window.document.querySelector('[data-dialog="rematch"]');

  it('draws straight through when nothing repeats', () => {
    const spies = panel([]);

    pressDraw();

    // The ordinary draw, which is every draw: one press, no dialog.
    expect(dialog()).toBeNull();
    expect(spies.onDraw).toHaveBeenCalledOnce();
  });

  it('asks before drawing when a pairing repeats, and draws nothing yet', () => {
    const spies = panel([match(1, { a: groupId(1), b: groupId(2) })]);

    pressDraw();

    expect(dialog()).not.toBeNull();
    // Nothing was committed. §3 says the host confirms *before* the draw is
    // published, so the press alone must not deal the round.
    expect(spies.onDraw).not.toHaveBeenCalled();
  });

  it('names every repeated pairing, so the host can read them out', () => {
    panel([match(1, { a: groupId(1), b: groupId(2) }), match(2, { a: groupId(3), b: groupId(4) })]);

    pressDraw();

    const listed = [...window.document.querySelectorAll('[data-dialog-pair]')].map(
      (node) => node.textContent,
    );

    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain(de.participant.GROUP.numbered({ n: 1 }));
    expect(listed[0]).toContain(de.participant.GROUP.numbered({ n: 2 }));
    expect(listed[1]).toContain(de.participant.GROUP.numbered({ n: 3 }));
  });

  it('draws once the host confirms', () => {
    const spies = panel([match(1, { a: groupId(1), b: groupId(2) })]);

    pressDraw();
    fireEvent.click(screen.getByRole('button', { name: de.draw.rematch.confirm }));

    expect(spies.onDraw).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it('changes nothing when the host cancels', () => {
    const spies = panel([match(1, { a: groupId(1), b: groupId(2) })]);

    pressDraw();
    fireEvent.click(screen.getByRole('button', { name: de.draw.rematch.cancel }));

    expect(spies.onDraw).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('marks the repeated pairing on its card for the rest of the round', () => {
    // The confirmation is one moment; the panel is the screen the host works
    // from all evening, so the pairing they were asked about stays marked.
    const document = drawn(4, 2);
    const first = openRound(document).matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    const open = openRound(document);

    render(
      <RoundPanel
        round={open}
        board={roundBoard(document, open)}
        summary={roundSummary(open)}
        groups={document.groups}
        participant={document.settings.participantLabel}
        now={FIXED_NOW}
        drawBlockers={['ROUND_OPEN']}
        canDraw={false}
        closeBlockers={['MATCHES_UNDECIDED']}
        canClose={false}
        undecided={open.matches.length}
        rematches={new Set([first.id])}
        {...handlers()}
      />,
    );

    expect(card(first.id).querySelector('[data-match-rematch]')?.textContent).toBe(
      de.draw.rematch.badge,
    );
    const other = openRound(document).matches[1];
    expect(
      other === undefined ? null : card(other.id).querySelector('[data-match-rematch]'),
    ).toBeNull();
  });
});

describe('deciding a match', () => {
  it('sets a winner with one click and no dialog', () => {
    const document = drawn(4, 2);
    const first = openRound(document).matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    const spies = setup(document);

    clickIn(card(first.id), '[data-match-action="winner"]');

    expect(spies.onSetWinner).toHaveBeenCalledWith(first.id, first.a);
    // No confirmation step of any kind between the click and the decision.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers both participants as targets, each at least 40 px tall', () => {
    const document = drawn(4, 2);
    const first = openRound(document).matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    setup(document);

    const targets = buttonsIn(card(first.id), '[data-match-action="winner"]');
    expect(targets).toHaveLength(2);
    // docs/STYLEGUIDE.md §3: 40 px for a high-frequency control. `h-12` is
    // 48 px; the assertion is on the class, because jsdom has no layout.
    for (const target of targets) {
      expect(target.className).toContain('h-12');
    }
  });

  it('has nothing to press for a bye, which the draw already decided', () => {
    // Five groups: two pairs and a leftover that advances without playing.
    const document = drawn(5, 2);
    const bye = openRound(document).matches.find((each) => each.b === null);
    if (bye === undefined) {
      throw new Error('no bye was drawn');
    }
    setup(document);

    expect(buttonsIn(card(bye.id), 'button')).toHaveLength(0);
    expect(card(bye.id).getAttribute('data-match-state')).toBe('bye');
  });
});

describe('correcting a decided match', () => {
  /** One decided match and one still open, on two tables. */
  function decided(): Tournament {
    const document = drawn(4, 2);
    const open = openRound(document);
    const first = open.matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    return {
      ...document,
      rounds: [
        {
          ...open,
          matches: open.matches.map((each) =>
            each.id === first.id ? { ...each, winnerId: each.a, status: 'DONE' as const } : each,
          ),
        },
      ],
    };
  }

  const decidedMatch = (document: Tournament): MatchId => {
    const found = openRound(document).matches.find((each) => each.winnerId !== null);
    if (found === undefined) {
      throw new Error('nothing is decided');
    }
    return found.id;
  };

  it('shows the result instead of the targets, so a stray click cannot flip it', () => {
    const document = decided();
    const spies = setup(document);
    const finished = card(decidedMatch(document));

    expect(buttonsIn(finished, '[data-match-action="winner"]')).toHaveLength(0);
    // The whole card is clicked at: nothing on it decides anything.
    fireEvent.click(finished);
    expect(spies.onSetWinner).not.toHaveBeenCalled();
  });

  it('takes a deliberate second interaction to change the result', () => {
    const document = decided();
    const spies = setup(document);
    const id = decidedMatch(document);

    clickIn(card(id), '[data-match-action="correct"]');
    expect(spies.onSetWinner).not.toHaveBeenCalled();

    const targets = buttonsIn(card(id), '[data-match-action="winner"]');
    expect(targets).toHaveLength(2);
    fireEvent.click(targets[1] as HTMLElement);

    const changed = openRound(document).matches.find((each) => each.id === id);
    expect(spies.onSetWinner).toHaveBeenCalledWith(id, changed?.b);
  });

  it('closes the correction again without deciding anything', () => {
    const document = decided();
    const spies = setup(document);
    const id = decidedMatch(document);

    clickIn(card(id), '[data-match-action="correct"]');
    clickIn(card(id), '[data-match-action="cancel"]');

    expect(buttonsIn(card(id), '[data-match-action="winner"]')).toHaveLength(0);
    expect(spies.onSetWinner).not.toHaveBeenCalled();
  });

  it('arms one card at a time, so no card is left open behind the host', () => {
    // Two decided matches, four groups on two tables.
    const base = drawn(4, 2);
    const open = openRound(base);
    const document: Tournament = {
      ...base,
      rounds: [
        {
          ...open,
          matches: open.matches.map((each) => ({
            ...each,
            winnerId: each.a,
            status: 'DONE' as const,
          })),
        },
      ],
    };
    const [first, second] = openRound(document).matches;
    if (first === undefined || second === undefined) {
      throw new Error('nothing was drawn');
    }
    setup(document);

    clickIn(card(first.id), '[data-match-action="correct"]');
    clickIn(card(second.id), '[data-match-action="correct"]');

    expect(buttonsIn(card(first.id), '[data-match-action="winner"]')).toHaveLength(0);
    expect(buttonsIn(card(second.id), '[data-match-action="winner"]')).toHaveLength(2);
  });
});

describe('the board', () => {
  it('keeps thirty-two matches on the screen at once', () => {
    // The issue's third acceptance criterion, at the size it names.
    const document = drawn(64, 8);
    setup(document);

    expect(window.document.querySelectorAll('[data-match-id]')).toHaveLength(32);
  });

  it('groups the matches by table and keeps the queue apart from them', () => {
    const document = drawn(8, 1);
    setup(document);

    // One table, so one match is being played and three are waiting.
    expect(window.document.querySelectorAll('[data-round-table] [data-match-id]')).toHaveLength(1);
    expect(
      window.document.querySelectorAll('[data-round-queue="list"] [data-match-id]'),
    ).toHaveLength(3);
  });

  it('offers the next waiting pair to a table that has come free', () => {
    // Eight groups on two tables, the match on table 1 already decided — which
    // is what freed it (docs/TOURNAMENT-RULES.md §3).
    const base = drawn(8, 2);
    const open = openRound(base);
    const first = open.matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    const document: Tournament = {
      ...base,
      tables: base.tables.map((each) =>
        each.id === first.tableId
          ? { ...each, status: 'FREE' as const, currentMatchId: null, occupiedSince: null }
          : each,
      ),
      rounds: [
        {
          ...open,
          matches: open.matches.map((each) =>
            each.id === first.id ? { ...each, winnerId: each.a, status: 'DONE' as const } : each,
          ),
        },
      ],
    };
    const spies = setup(document);

    const free = window.document.querySelector(`[data-round-table="${tableId(1)}"]`);
    if (!(free instanceof HTMLElement)) {
      throw new Error('no free table on the board');
    }
    clickIn(free, '[data-round-action="next"]');

    expect(spies.onStartNext).toHaveBeenCalledWith(tableId(1));
  });

  it('has nothing to start on a free table with an empty queue', () => {
    const document = drawn(4, 4);
    setup(document);

    const buttons = [...window.document.querySelectorAll('[data-round-action="next"]')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveProperty('disabled', true);
    }
  });
});

describe('the header and the summary', () => {
  it('reads the progress of the round', () => {
    const base = drawn(8, 2);
    const open = openRound(base);
    const document: Tournament = {
      ...base,
      rounds: [
        {
          ...open,
          matches: open.matches.map((each, index) =>
            index < 3 ? { ...each, winnerId: each.a, status: 'DONE' as const } : each,
          ),
        },
      ],
    };
    setup(document);

    expect(window.document.querySelector('[data-round-progress]')?.textContent).toBe(
      de.round.progress({ decided: 3, total: 4 }),
    );
  });

  it('counts the winners and the losers as they are decided', () => {
    const base = drawn(8, 2);
    const open = openRound(base);
    const document: Tournament = {
      ...base,
      rounds: [
        {
          ...open,
          matches: open.matches.map((each, index) =>
            index < 3 ? { ...each, winnerId: each.a, status: 'DONE' as const } : each,
          ),
        },
      ],
    };
    setup(document);

    expect(window.document.querySelector('[data-round-summary="winners"]')?.textContent).toBe(
      de.round.summaryWinners({ n: 3 }),
    );
    expect(window.document.querySelector('[data-round-summary="losers"]')?.textContent).toBe(
      de.round.summaryLosers({ n: 3 }),
    );
  });

  it('names the repechage target the draw already determined', () => {
    // Six groups make three matches, so three come through and the bracket
    // needs four (docs/TOURNAMENT-RULES.md §4).
    setup(drawn(6, 2));

    expect(window.document.querySelector('[data-round-summary="repechage"]')?.textContent).toBe(
      de.round.summaryRepechage({ target: 4, need: 1 }),
    );
  });

  it('says so when the repechage is not needed at all', () => {
    setup(drawn(8, 2));

    expect(window.document.querySelector('[data-round-summary="repechage"]')?.textContent).toBe(
      de.round.summaryRepechageSkipped({ target: 4 }),
    );
  });
});

describe('the two round-level buttons', () => {
  it('refuses to close the round while a match has no winner, and says why', () => {
    const document = drawn(8, 2);
    setup(document);

    const close = screen.getByText(de.round.close);
    expect(close).toHaveProperty('disabled', true);
    expect(close.getAttribute('aria-label')).toBe(
      de.round.closeBlocked({ reason: de.round.closeUndecided({ n: 4 }) }),
    );
    expect(window.document.querySelector('[data-round-close-reason]')?.textContent).toBe(
      de.round.closeUndecided({ n: 4 }),
    );
  });

  it('closes the round once every match is decided', () => {
    const base = drawn(4, 2);
    const open = openRound(base);
    const document: Tournament = {
      ...base,
      rounds: [
        {
          ...open,
          matches: open.matches.map((each) => ({
            ...each,
            winnerId: each.a,
            status: 'DONE' as const,
          })),
        },
      ],
    };
    const spies = setup(document);

    const close = screen.getByText(de.round.close);
    expect(close).toHaveProperty('disabled', false);
    fireEvent.click(close);

    expect(spies.onClose).toHaveBeenCalled();
  });

  it('says why it will not draw while a round is open', () => {
    setup(drawn(4, 2));

    const draw = screen.getByText(de.draw.start);
    expect(draw).toHaveProperty('disabled', true);
    expect(draw.getAttribute('aria-label')).toBe(de.draw.blocked({ reason: de.draw.roundOpen }));
  });

  it('draws when there is no round open', () => {
    const spies = setup(tournament({ phase: 'QUALIFYING', groups: [group(1), group(2)] }));

    const draw = screen.getByText(de.draw.start);
    expect(draw).toHaveProperty('disabled', false);
    fireEvent.click(draw);

    expect(spies.onDraw).toHaveBeenCalled();
    expect(window.document.querySelector('[data-round-none]')?.textContent).toBe(de.round.none);
  });

  it('cannot stage a round on the beamer when there is none', () => {
    setup(tournament({ phase: 'QUALIFYING', groups: [group(1), group(2)] }));

    expect(screen.getByText(de.round.showOnBeamer)).toHaveProperty('disabled', true);
  });

  it('stages the open round on the beamer', () => {
    const spies = setup(drawn(4, 2));

    fireEvent.click(screen.getByText(de.round.showOnBeamer));

    expect(spies.onShowOnBeamer).toHaveBeenCalled();
  });
});

describe('a round loaded mid-tournament', () => {
  it('draws a round whose matches are spread across all three sections', () => {
    // What a file opened halfway through a round looks like: one running, one
    // waiting, one already decided (CLAUDE.md §7).
    const document = tournament({
      phase: 'QUALIFYING',
      groups: [group(1), group(2), group(3), group(4), group(5), group(6)],
      tables: [occupiedTable(1, matchId(1)), table(2)],
      rounds: [
        round(1, {
          state: 'RUNNING',
          matches: [
            match(1, { tableId: tableId(1), status: 'RUNNING' }),
            match(2, { a: groupId(3), b: groupId(4) }),
            match(3, { a: groupId(5), b: groupId(6), winnerId: groupId(5), status: 'DONE' }),
          ],
        }),
      ],
    });
    setup(document);

    expect(window.document.querySelectorAll('[data-round-table] [data-match-id]')).toHaveLength(1);
    expect(
      window.document.querySelectorAll('[data-round-queue="list"] [data-match-id]'),
    ).toHaveLength(1);
    expect(
      window.document.querySelectorAll('[data-round-decided="list"] [data-match-id]'),
    ).toHaveLength(1);
  });
});

/**
 * Reserved tables on the round board (issue #79,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * The host reads this board when nothing is starting, so it has to answer the
 * question they are actually asking: is the app stuck, or is it doing what I
 * told it to? Two things do that — the badge on the table, and the sentence
 * over the queue when nothing is going to happen at all.
 */
describe('a table reserved for the other track', () => {
  it('says so on the table it is reserved for', () => {
    const document = reserveTable(drawn(4, 2), tableId(1), 'CONSOLATION');
    setup(document);

    const badge = window.document.querySelector('[data-table-reserved]');
    expect(badge?.getAttribute('data-table-reserved')).toBe('CONSOLATION');
    expect(badge?.textContent).toBe(
      de.table.reservation.badge({ track: de.table.reservation.CONSOLATION }),
    );
  });

  it('says nothing on a table that serves both', () => {
    setup(drawn(4, 2));

    expect(window.document.querySelector('[data-table-reserved]')).toBeNull();
  });

  /*
   * The issue's "the host is told why". Reserving the tables *after* the draw
   * is the case that matters: the pairings are already queued, and a host who
   * had no explanation would go looking at the furniture.
   */
  it('explains a queue that cannot move at all', () => {
    let document = drawn(6, 2);
    for (const entry of document.tables) {
      document = reserveTable(document, entry.id, 'CONSOLATION');
    }
    setup(document);

    expect(screen.getByText(de.round.stalled.RESERVED_ELSEWHERE)).toBeTruthy();
  });

  /* A queue behind busy tables is the tournament working as §3 intends, and a
   * warning on every round is one the host learns to read past. */
  it('says nothing while the tables are simply busy', () => {
    setup(drawn(6, 2));

    expect(screen.queryByText(de.round.stalled.RESERVED_ELSEWHERE)).toBeNull();
    expect(screen.queryByText(de.round.stalled.NO_USABLE_TABLE)).toBeNull();
  });
});
