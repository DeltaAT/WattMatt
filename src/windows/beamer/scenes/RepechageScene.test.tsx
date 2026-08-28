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
import { NO_TRAVEL, type RepechageTravel } from '@/windows/beamer/useRepechageTravel';

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

function scene(
  document: Tournament,
  beat: GroupId | null = null,
  travel: RepechageTravel = NO_TRAVEL,
): string {
  return renderToStaticMarkup(
    <RepechageScene tournament={toTournamentSnapshot(document)} beat={beat} travel={travel} />,
  );
}

/** A travel in flight, with the light on `highlight` and `pending` held back. */
const travelling = (pending: GroupId | null, highlight: GroupId | null): RepechageTravel => ({
  pending,
  highlight,
  isTravelling: true,
  skip: () => undefined,
});

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
    while ((repechageState(document)?.remaining.length ?? 0) > 0) {
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

/*
 * Issue #89. The snapshot carries the answer from the first frame — the pot
 * already has one entry at `DRAWN` — so every assertion here is a way of
 * asking whether the picture gives it away before the light gets there.
 */
describe('the travelling highlight', () => {
  const drawn = () => drawCandidate(started());

  /* The card the light is on. Only one, ever: two lit cards is a highlight the
   * eye cannot follow, and the room would not know which one landed. */
  it('lights exactly one card', () => {
    const document = drawn();
    // Anybody still in the pool: a card the light may legitimately pass over.
    const elsewhere = repechageState(document)?.remaining[0] ?? null;

    const markup = scene(document, pendingOf(document), travelling(pendingOf(document), elsewhere));

    expect(markup.match(/data-pot-lit=""/g)).toHaveLength(1);
    expect(markup).toContain(`data-group-id="${String(elsewhere)}" data-pot-status="POOL"`);
  });

  /*
   * The failure the whole issue exists to remove. `drawCandidate` has already
   * put the candidate at `DRAWN`, and a scene that simply rendered the snapshot
   * would lift them, name them and dim everybody else two seconds before the
   * light arrived.
   */
  it('keeps the drawn candidate in the crowd until the light lands', () => {
    const document = drawn();
    const candidate = pendingOf(document);
    // Anybody still in the pool: a card the light may legitimately pass over.
    const elsewhere = repechageState(document)?.remaining[0] ?? null;

    const markup = scene(document, candidate, travelling(candidate, elsewhere));

    // Painted, worded and animated exactly like everybody still in the pot.
    expect(markup).toContain(`data-group-id="${String(candidate)}" data-pot-status="POOL"`);
    expect(markup).not.toContain('data-pot-status="DRAWN"');
    expect(markup).not.toContain('wm-repechage-lift');
    expect(greyscale(markup)).not.toContain(de.beamer.repechage.status.DRAWN);
  });

  /*
   * The dimming is half of the landing (docs/MOTION.md §4.3). A pot that
   * receded the instant the snapshot arrived would announce that somebody had
   * been drawn before the room could see who — the same tell, one step out.
   */
  it('does not dim the pot while the light is still moving', () => {
    const document = drawn();
    const candidate = pendingOf(document);

    expect(scene(document, candidate, travelling(candidate, candidate))).toContain(
      'data-drawing="false"',
    );
    expect(scene(document, candidate, travelling(candidate, candidate))).toContain(
      'data-travelling="true"',
    );
  });

  /*
   * And the landing itself: the travel is over, so the picture is exactly the
   * one this scene has always drawn for a candidate who is out — which is what
   * makes the skip, the natural end and a caught-up window agree.
   */
  it('is the ordinary drawn picture once it lands', () => {
    const document = drawn();
    const candidate = pendingOf(document);

    const landed: RepechageTravel = {
      pending: null,
      highlight: null,
      isTravelling: false,
      skip: () => undefined,
    };

    expect(scene(document, candidate, landed)).toBe(scene(document, candidate));
  });

  /* A window with no travel — catching up, holding still, or a pot too small
   * to travel across — draws the settled picture and nothing else. */
  it('draws no highlight when nothing is travelling', () => {
    expect(scene(drawn(), pendingOf(drawn()))).not.toContain('data-pot-lit');
    expect(scene(drawn(), pendingOf(drawn()))).toContain('data-travelling="false"');
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

/**
 * The grid must not carry the draw order (issue #97,
 * docs/TOURNAMENT-RULES.md §4).
 *
 * The pot used to be rendered in the pool's order — the shuffle — so the next
 * name was always the first `POOL` card on the wall and anyone watching could
 * call it before the light landed. The shuffle was not broken; it was thrown
 * away, because the thing it randomised became the thing on screen.
 *
 * These are the assertions that stop that coming back. They are on the scene
 * rather than only on the domain deliberately: this is the surface the audience
 * actually reads, and the leak was one render away from a correct engine.
 */
describe('what the grid is allowed to say', () => {
  /** The group numbers the cards carry, in the order they appear in the DOM. */
  function shownNumbers(document: Tournament, markup: string): number[] {
    const numbers = new Map(document.groups.map((entry) => [String(entry.id), entry.number]));
    return cards(markup).map(([groupId]) => numbers.get(groupId) ?? -1);
  }

  it('draws the cards ascending by number, which is a stable order', () => {
    const document = started();

    const numbers = shownNumbers(document, scene(document));

    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  /*
   * The crisp version of the whole issue: change the seed and the draw order
   * changes while the picture does not move at all. One played qualifying round
   * so both have the same losers — re-seeding the tournament would deal
   * different pairings and compare two different grids.
   */
  it('renders the same grid under a seed that draws in a different order', () => {
    const closed = qualified(13);
    const one = startRepechage({ ...closed, rngSeed: 'seed-one' });
    const other = startRepechage({ ...closed, rngSeed: 'seed-two' });

    expect(cards(scene(one))).toEqual(cards(scene(other)));
    expect(one.repechage?.pool).not.toEqual(other.repechage?.pool);
  });

  /*
   * Nobody is taken off the wall and nobody moves: a drawn card is marked where
   * it stands. Removing or reordering one reflows the grid, shifts every
   * position after it and makes the screen jump — the same argument the
   * pre-computed layout of issue #76 makes.
   */
  it('never moves a card as candidates are drawn and answered', () => {
    let document = started();
    const before = cards(scene(document)).map(([groupId]) => groupId);

    document = acceptCandidate(drawCandidate(document));
    expect(cards(scene(document)).map(([groupId]) => groupId)).toEqual(before);

    document = declineCandidate(drawCandidate(document));
    expect(cards(scene(document)).map(([groupId]) => groupId)).toEqual(before);
  });

  /*
   * Nothing rendered may be derived from a card's position — no index badge, no
   * per-card animation delay, no z-order. A stagger in pool order would hand
   * the room the whole sequence on the very first frame; one in display order
   * would be harmless, but the cheapest way to keep the distinction honest is
   * to have no per-card position value on the pot at all.
   */
  it('gives no card a per-position style, delay or index', () => {
    const markup = scene(started());
    const pot = markup.slice(markup.indexOf('data-repechage-pot'));

    expect(pot).not.toContain('--wm-reveal-index');
    expect(pot).not.toContain('animation-delay');
    expect(pot).not.toContain('z-index');
    // The cards carry no inline style of any kind, which is what makes the
    // three checks above hold for anything added later as well.
    expect(pot).not.toMatch(/<li[^>]*\sstyle=/);
  });
});
