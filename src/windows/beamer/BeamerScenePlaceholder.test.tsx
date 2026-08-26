import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildBracket } from '@/domain/bracket';
import { groupIdSchema, matchIdSchema, roundIdSchema } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import { EMPTY_TOURNAMENT, toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import { group, tournament } from '@/domain/testFixtures';
import type { Round } from '@/domain/types';
import { de } from '@/i18n';
import { BeamerScenePlaceholder } from '@/windows/beamer/BeamerScenePlaceholder';

const round = (value: string) => roundIdSchema.parse(value);

describe('the beamer scene surface', () => {
  it('renders the scene the host staged, not a fixed screen', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'CEREMONY' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );
    expect(markup).toContain('data-scene="CEREMONY"');
    expect(markup).toContain(de.beamer.scenePending);
  });

  /*
   * The Hoffnungsrunde is drawn for real from issue #21 on. Staged before the
   * phase is started there is no pot to show, and the scene says so rather than
   * falling back to the generic placeholder: the host can stage it by hand, and
   * a projector reading "Ansicht wird vorbereitet" would leave the room waiting
   * for something that is not coming.
   */
  it('draws the Hoffnungsrunde rather than a placeholder', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'REPECHAGE' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );

    expect(markup).toContain('data-scene="REPECHAGE"');
    expect(markup).not.toContain(de.beamer.scenePending);
    expect(markup).toContain(de.beamer.repechage.empty);
  });

  /*
   * The draw is drawn for real from issue #18 on. With no round in the snapshot
   * there is nothing to deal, and the scene says so rather than falling back to
   * the generic placeholder — a blank projector during the Auslosung is the one
   * moment the room is actually watching.
   */
  it('draws the Auslosung rather than a placeholder', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'DRAW', roundId: round('r2') }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );

    expect(markup).toContain('data-scene="DRAW"');
    expect(markup).not.toContain(de.beamer.scenePending);
    expect(markup).toContain(de.beamer.draw.empty);
  });

  /* Two scenes are drawn for real rather than as a placeholder: the occupancy
   * board (issue #13) and the field of participants (issue #14). */
  it('draws the group overview rather than a placeholder', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'GROUP_OVERVIEW' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );

    expect(markup).toContain('data-scene="GROUP_OVERVIEW"');
    expect(markup).not.toContain(de.beamer.scenePending);
  });

  it('shows nothing at all during a blackout', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'BLACKOUT' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );
    expect(markup).toContain('data-scene="BLACKOUT"');
    // Any text here would be a lit rectangle in a dark room.
    expect(markup).not.toContain(de.beamer.idleTitle);
    expect(markup).not.toContain(de.beamer.scenePending);
  });

  /*
   * Issue #22: the host is asked "wen hat er in der zweiten Runde geschlagen?"
   * and puts that round back on the wall while the next one is running. The
   * board has to draw the round the descriptor names, not the one that happens
   * to be open.
   */
  describe('a round board pointed at the history', () => {
    const past: Round = {
      id: round('rnd_1'),
      index: 1,
      kind: 'QUALIFYING',
      label: 'Runde 1',
      state: 'CLOSED',
      matches: [
        {
          id: matchIdSchema.parse('mt_1'),
          tableId: null,
          a: groupIdSchema.parse('grp_1'),
          b: groupIdSchema.parse('grp_2'),
          winnerId: groupIdSchema.parse('grp_1'),
          status: 'DONE',
        },
      ],
    };

    const snapshot: TournamentSnapshot = {
      ...EMPTY_TOURNAMENT,
      groups: [
        { id: groupIdSchema.parse('grp_1'), number: 1, name: null, status: 'ACTIVE' },
        { id: groupIdSchema.parse('grp_2'), number: 2, name: null, status: 'ELIMINATED' },
      ],
      // A different round is open — the live one the host has not left.
      round: {
        id: round('rnd_2'),
        index: 2,
        kind: 'ELIMINATION',
        label: 'Runde 2',
        state: 'RUNNING',
      },
      matches: [],
      history: [past],
    };

    it('draws the closed round the scene names', () => {
      const markup = renderToStaticMarkup(
        <BeamerScenePlaceholder
          scene={{ id: 'ROUND_BOARD', roundId: past.id }}
          tournament={snapshot}
          settled
          delivery="catchUp"
        />,
      );

      expect(markup).toContain('data-scene="ROUND_BOARD"');
      expect(markup).toContain(past.label);
      // The pairing of that round, not of the one that is running.
      expect(markup).toContain(de.participant.GROUP.numbered({ n: 1 }));
      expect(markup).toContain(de.participant.GROUP.numbered({ n: 2 }));
    });

    it('still draws the open round when that is the one named', () => {
      const markup = renderToStaticMarkup(
        <BeamerScenePlaceholder
          scene={{ id: 'ROUND_BOARD', roundId: round('rnd_2') }}
          tournament={snapshot}
          settled
          delivery="catchUp"
        />,
      );

      expect(markup).toContain('Runde 2');
      expect(markup).not.toContain(past.label);
    });

    /*
     * An undo can take a round away while the projector is still pointed at it.
     * An empty board is honest; the next round's pairings under the previous
     * round's heading would not be.
     */
    it('draws an empty board for a round that no longer exists', () => {
      const markup = renderToStaticMarkup(
        <BeamerScenePlaceholder
          scene={{ id: 'ROUND_BOARD', roundId: round('rnd_9') }}
          tournament={snapshot}
          settled
          delivery="catchUp"
        />,
      );

      expect(markup).toContain('data-scene="ROUND_BOARD"');
      expect(markup).not.toContain(past.label);
      expect(markup).not.toContain('Runde 2');
    });
  });

  /*
   * The holding picture of issue #23. Staged whenever the host is entering
   * names, and it is the projector's protection against a list filling up one
   * name at a time in front of the room.
   */
  it('draws the naming holding picture rather than a placeholder', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'NAMING' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );

    expect(markup).toContain('data-scene="NAMING"');
    expect(markup).not.toContain(de.beamer.scenePending);
    expect(markup).toContain(de.beamer.naming.title);
  });

  it('draws the Turnierbaum rather than a placeholder', () => {
    const groups = [
      group(1, { name: 'Team 1' }),
      group(2, { name: 'Team 2' }),
      group(3, { name: 'Team 3' }),
      group(4, { name: 'Team 4' }),
    ];
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'BRACKET' }}
        tournament={toTournamentSnapshot(
          tournament({
            phase: 'BRACKET',
            groups,
            nextGroupNumber: 5,
            bracket: buildBracket(groups, { rng: createRng('seed') }),
          }),
        )}
        settled
        delivery="catchUp"
      />,
    );

    expect(markup).toContain('data-scene="BRACKET"');
    expect(markup).not.toContain(de.beamer.scenePending);
    expect(markup).toContain(de.bracket.round.SEMI_FINAL);
    expect(markup.match(/data-bracket-node="/g)).toHaveLength(4);
  });

  it('marks a caught-up scene as settled so it is not animated in', () => {
    const settled = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'BRACKET' }}
        tournament={EMPTY_TOURNAMENT}
        settled
        delivery="catchUp"
      />,
    );
    const animating = renderToStaticMarkup(
      <BeamerScenePlaceholder
        scene={{ id: 'BRACKET' }}
        tournament={EMPTY_TOURNAMENT}
        settled={false}
        delivery="live"
      />,
    );

    expect(settled).toContain('data-settled="true"');
    expect(animating).toContain('data-settled="false"');
  });
});
