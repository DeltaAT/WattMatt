import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { roundIdSchema } from '@/domain/ids';
import { EMPTY_TOURNAMENT } from '@/domain/snapshot';
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
