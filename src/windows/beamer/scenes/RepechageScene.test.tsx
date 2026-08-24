import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { closeRound, drawRound, roundOutcome, setWinner } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import {
  acceptCandidate,
  declineCandidate,
  drawCandidate,
  repechageState,
  startRepechage,
  useRepechageFallback,
} from '@/domain/repechage';
import { currentRound } from '@/domain/selectors';
import { toTournamentSnapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { RepechageScene } from '@/windows/beamer/scenes/RepechageScene';

/**
 * `REPECHAGE` (issue #21) — the second chance, live in front of the room.
 *
 * Two acceptance criteria drive the design and both are asserted here. *The
 * audience can always tell how many slots remain*, so the counter is on the
 * wall in every state including zero. And nobody may vanish off the pot: the
 * person who came to watch their friend has to be able to follow that friend
 * from the first frame to the last, which is what the count assertions below
 * are really about.
 *
 * The colour classes are stripped for the state assertions, as `ROUND_BOARD`
 * does: a projector in a bright room flattens hues, so every state has to be
 * readable in greyscale from its word alone (docs/STYLEGUIDE.md §1).
 */

function qualified(groups: number, tables = 2): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => de.round.title({ n: index }) });
  let decided = drawn;
  for (const match of openRound(drawn).matches) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

function openRound(document: Tournament): Round {
  const round = currentRound(document) ?? document.rounds[0];
  if (round === undefined) {
    throw new Error('nothing was drawn');
  }
  return round;
}

/** 13 groups: 7 winners, target 8, one place to fill from a pot of six. */
const started = () => startRepechage(qualified(13));

const pendingOf = (document: Tournament) => repechageState(document)?.pending ?? null;

function scene(document: Tournament, beat: GroupId | null = null): string {
  return renderToStaticMarkup(
    <RepechageScene tournament={toTournamentSnapshot(document)} beat={beat} />,
  );
}

/** The pot cards, as `[groupId, status]`, straight out of the markup. */
function cards(markup: string): [string, string][] {
  return [...markup.matchAll(/data-group-id="([^"]+)" data-pot-status="([^"]+)"/g)].map((found) => [
    found[1] ?? '',
    found[2] ?? '',
  ]);
}

const potSize = (markup: string) => cards(markup).length;

describe('the pot', () => {
  it('shows every loser from the first frame, before anything is drawn', () => {
    const document = started();
    const losers = roundOutcome(openRound(document)).losers;

    const markup = scene(document);

    expect(potSize(markup)).toBe(losers.length);
    for (const loser of losers) {
      expect(markup).toContain(`data-group-id="${loser}"`);
    }
  });

  /**
   * Nobody ever leaves the wall. A drawn candidate, an acceptance and a decline
   * all change a card *in place* — a scene that moved cards between three lists
   * would lose the one person the audience is following.
   */
  it('never loses a card, whatever happens to it', () => {
    const document = started();
    const size = potSize(scene(document));

    expect(potSize(scene(drawCandidate(document)))).toBe(size);
    expect(potSize(scene(acceptCandidate(drawCandidate(document))))).toBe(size);
    expect(potSize(scene(declineCandidate(drawCandidate(document))))).toBe(size);
  });

  it('marks the drawn candidate, and only them', () => {
    const drawn = drawCandidate(started());
    const candidate = pendingOf(drawn);

    const drawnCards = cards(scene(drawn)).filter(([, status]) => status === 'DRAWN');

    expect(drawnCards).toEqual([[candidate, 'DRAWN']]);
  });

  it('says what happened to each card in words, not only in colour', () => {
    const accepted = acceptCandidate(drawCandidate(started()));
    const declined = declineCandidate(drawCandidate(started()));
    const drawn = drawCandidate(started());

    expect(greyscale(scene(drawn))).toContain(de.beamer.repechage.status.DRAWN);
    expect(greyscale(scene(accepted))).toContain(de.beamer.repechage.status.ACCEPTED);
    expect(greyscale(scene(declined))).toContain(de.beamer.repechage.status.DECLINED);
    expect(greyscale(scene(started()))).toContain(de.beamer.repechage.status.POOL);
  });
});

describe('the counter', () => {
  /* "The audience can always tell how many slots remain" — the criterion. */
  it('says how many places are still free', () => {
    expect(scene(started())).toContain(de.beamer.repechage.slotsLeft({ n: 1 }));
    expect(scene(started())).toContain(de.beamer.repechage.target({ n: 8 }));
  });

  it('ticks up when a candidate accepts', () => {
    const accepted = acceptCandidate(drawCandidate(started()));

    expect(scene(accepted)).toContain(de.beamer.repechage.slotsFilled);
    expect(scene(accepted)).not.toContain(de.beamer.repechage.slotsLeft({ n: 1 }));
  });

  it('does not move when a candidate declines', () => {
    const declined = declineCandidate(drawCandidate(started()));

    expect(scene(declined)).toContain(de.beamer.repechage.slotsLeft({ n: 1 }));
  });
});

describe('the winners column', () => {
  it('is on the wall from the first frame, with the qualifying winners in it', () => {
    const document = started();
    const winners = roundOutcome(openRound(document)).winners;

    const markup = scene(document);
    const column = markup.slice(markup.indexOf('data-repechage-through'));

    for (const winner of winners) {
      expect(column).toContain(`data-group-id="${winner}"`);
    }
  });

  it('gains the accepted candidate', () => {
    const accepted = acceptCandidate(drawCandidate(started()));
    const candidate = repechageState(accepted)?.through.at(-1);

    const markup = scene(accepted);
    const column = markup.slice(markup.indexOf('data-repechage-through'));

    expect(column).toContain(`data-group-id="${candidate}"`);
  });

  /*
   * The `Freilose` of §4's first fallback are places nobody is standing in. A
   * column that came up short against the target with no explanation is how a
   * room decides the app has miscounted.
   */
  it('says how many Freilose the fallback owes the next round', () => {
    let document = started();
    while ((repechageState(document)?.pool.length ?? 0) > 0) {
      document = declineCandidate(drawCandidate(document));
    }

    expect(scene(useRepechageFallback(document, 'BYES'))).toContain(
      de.beamer.repechage.byes({ n: 1 }),
    );
  });
});

describe('the choreography', () => {
  /**
   * docs/MOTION.md §4.3, and only ever one card at a time: animating the pot
   * would blow the 60-element budget of §6 and read as a flicker rather than as
   * one thing happening.
   */
  it('plays one beat, on the card the beat is about', () => {
    const drawn = drawCandidate(started());
    const candidate = pendingOf(drawn);

    const markup = scene(drawn, candidate);

    expect(markup).toContain('wm-repechage-lift');
    expect(markup.match(/wm-repechage-lift/g)).toHaveLength(1);
  });

  it('has a beat of its own for accepting and for declining', () => {
    const drawn = drawCandidate(started());
    const candidate = pendingOf(drawn);

    expect(scene(acceptCandidate(drawn), candidate)).toContain('wm-repechage-accept');
    expect(scene(acceptCandidate(drawn), candidate)).toContain('wm-repechage-arrive');
    expect(scene(declineCandidate(drawn), candidate)).toContain('wm-repechage-decline');
  });

  /**
   * A beamer reopened mid-phase, or an undo: the picture is put where it
   * belongs without anything playing out in front of the room (CLAUDE.md golden
   * rule 4). `beat` is null then, and no card carries an animation.
   */
  it('plays nothing at all when the window is catching up', () => {
    const declined = declineCandidate(drawCandidate(started()));

    const markup = scene(declined, null);

    expect(markup).not.toContain('wm-repechage-');
    // …but the picture is still the right one.
    expect(greyscale(markup)).toContain(de.beamer.repechage.status.DECLINED);
  });

  it('dims the rest of the pot only while a candidate is out', () => {
    expect(scene(drawCandidate(started()))).toContain('data-drawing="true"');
    expect(scene(started())).toContain('data-drawing="false"');
  });
});

describe('a scene with nothing to show', () => {
  /*
   * The host can stage this by hand before starting the phase. Said out loud
   * rather than left as an empty screen: a blank projector in the middle of an
   * event reads as broken.
   */
  it('says the pot is empty rather than showing a bare screen', () => {
    const markup = scene(qualified(13));

    expect(markup).toContain('data-scene="REPECHAGE"');
    expect(markup).toContain(de.beamer.repechage.empty);
  });
});

/**
 * The markup with every colour class taken out — the closest a unit test gets
 * to squinting at the wall from ten metres with the hues gone.
 */
function greyscale(markup: string): string {
  return markup.replace(/class="[^"]*"/g, '');
}
