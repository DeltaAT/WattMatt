// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { roundHistory } from '@/domain/round';
import { group, groupId, match, round, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { RoundHistoryPanel } from '@/windows/host/RoundHistoryPanel';

/**
 * The round history (issue #22).
 *
 * The question it exists for is asked into a microphone — *wen hat sie in der
 * zweiten Runde geschlagen?* — so what is checked here is that the answer is
 * reachable without undoing anything, that the round the host wants is the one
 * nearest the top, and that putting a round on the projector is a decision they
 * take rather than one that happens to them.
 */

afterEach(cleanup);

const played = tournament({
  groups: [group(1), group(2), group(3), group(4)],
  rounds: [
    round(1, {
      kind: 'QUALIFYING',
      label: 'Runde 1',
      state: 'CLOSED',
      matches: [
        match(1, { a: groupId(1), b: groupId(2), winnerId: groupId(1), status: 'DONE' }),
        match(2, { a: groupId(3), b: null, winnerId: groupId(3), status: 'DONE' }),
      ],
    }),
    round(2, {
      kind: 'ELIMINATION',
      label: 'Runde 2',
      state: 'RUNNING',
      matches: [match(3, { a: groupId(1), b: groupId(3) })],
    }),
  ],
});

const history = roundHistory(played);

function renderPanel(onShowOnBeamer = vi.fn()) {
  render(
    <RoundHistoryPanel
      history={history}
      groups={played.groups}
      participant="GROUP"
      onShowOnBeamer={onShowOnBeamer}
    />,
  );
  return onShowOnBeamer;
}

describe('the round history panel', () => {
  it('lists every round of the evening', () => {
    renderPanel();

    expect(screen.getByText('Runde 1')).toBeTruthy();
    expect(screen.getByText('Runde 2')).toBeTruthy();
  });

  /*
   * The round the host wants is nearly always the one that just ended, and a
   * list that grows downwards puts it further away with every round played.
   */
  it('puts the most recent round first', () => {
    const { container } = render(
      <RoundHistoryPanel
        history={history}
        groups={played.groups}
        participant="GROUP"
        onShowOnBeamer={vi.fn()}
      />,
    );

    const labels = [...container.querySelectorAll('[data-history-round]')].map((node) =>
      node.getAttribute('data-history-round'),
    );
    expect(labels).toEqual(['rnd_2', 'rnd_1']);
  });

  it('says how a round ended without opening it', () => {
    renderPanel();

    expect(screen.getByText(de.history.result({ winners: 2, losers: 1 }))).toBeTruthy();
  });

  /* The pairings are behind one click, so four rounds of twenty matches do not
   * bury the controls the host actually needs. */
  it('shows who beat whom once the round is opened', () => {
    renderPanel();

    const winner = de.participant.GROUP.numbered({ n: 1 });
    const loser = de.participant.GROUP.numbered({ n: 2 });
    expect(screen.queryByText(de.history.pairing({ winner, loser }))).toBeNull();

    fireEvent.click(screen.getAllByText(de.history.show)[1] as HTMLElement);

    expect(screen.getByText(de.history.pairing({ winner, loser }))).toBeTruthy();
    // A bye had nobody to beat, and is said so rather than drawn as a pairing.
    expect(
      screen.getByText(
        de.history.byePairing({ participant: de.participant.GROUP.numbered({ n: 3 }) }),
      ),
    ).toBeTruthy();
  });

  it('keeps one round open at a time', () => {
    const { container } = render(
      <RoundHistoryPanel
        history={history}
        groups={played.groups}
        participant="GROUP"
        onShowOnBeamer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByText(de.history.show)[0] as HTMLElement);
    fireEvent.click(screen.getAllByText(de.history.show)[0] as HTMLElement);

    expect(container.querySelectorAll('[data-history-matches]')).toHaveLength(1);
  });

  it('puts the round the host chose on the projector', () => {
    const onShowOnBeamer = renderPanel();

    fireEvent.click(screen.getAllByText(de.history.showOnBeamer)[1] as HTMLElement);

    expect(onShowOnBeamer).toHaveBeenCalledWith('rnd_1');
  });

  it('says so plainly before anything has been drawn', () => {
    render(
      <RoundHistoryPanel history={[]} groups={[]} participant="GROUP" onShowOnBeamer={vi.fn()} />,
    );

    expect(screen.getByText(de.history.empty)).toBeTruthy();
  });
});
