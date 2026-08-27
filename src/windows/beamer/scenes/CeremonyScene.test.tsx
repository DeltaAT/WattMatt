// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawBracket, setBracketWinner } from '@/domain/bracket';
import type { GroupId } from '@/domain/ids';
import { MAX_GROUP_NAME_LENGTH } from '@/domain/naming';
import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, NAME_BUDGET } from '@/ui/nameFit';
import { CeremonyScene } from '@/windows/beamer/scenes/CeremonyScene';
import { CeremonySceneHost } from '@/windows/beamer/scenes/CeremonySceneHost';

/**
 * `CEREMONY` (issues #27 and #69) — the last picture of the evening and the one
 * the whole room photographs.
 *
 * Issue #69 is why every assertion here is about a *pairing*. The scene shipped
 * with the runner-up's name under the word `Bronze` and third place under
 * `Silber`, and the test that was supposed to cover it asked only whether the
 * three markers appeared in the order 2 · 1 · 3 and whether the three names
 * appeared *somewhere* — both of which a completely wrong podium passes. So
 * nothing below asserts that a name is present; everything asserts which
 * caption it stands under, and every reveal step asserts what is **not** there
 * yet as well as what is.
 */

/** Enough groups to fill a bracket, all named, so the draw can run. */
function named(count: number): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: Array.from({ length: count }, (_unused, index) =>
      group(index + 1, { name: `Team ${index + 1}` }),
    ),
    nextGroupNumber: count + 1,
    tables: [table(1), table(2)],
    nextTableNumber: 3,
  });
}

/**
 * A tournament whose whole tree has been played, `Spiel um Platz 3` included.
 *
 * Played rather than hand-written: the podium is read off the tree, so a
 * hand-built bracket would let this file agree with a scene that reads it
 * wrongly. Side A wins everywhere, which is arbitrary and enough — what the
 * assertions use is the node the win happened in, not who it was.
 */
function played(size: number): Tournament {
  const drawn = drawBracket(named(size), { at: FIXED_NOW });
  let current = drawn;

  // `layOut` orders the nodes rounds-first, so deciding them in order fills the
  // final and the third-place match before either is reached.
  for (const { id } of drawn.bracket?.nodes ?? []) {
    const node = current.bracket?.nodes.find((candidate) => candidate.id === id);
    const winner = node?.slotA ?? node?.slotB ?? null;
    if (node === undefined || node.winnerId !== null || winner === null) {
      continue;
    }
    current = setBracketWinner(current, id, winner);
  }

  return { ...current, phase: 'CEREMONY' };
}

/** Who the tree says finished where, worked out from the nodes themselves. */
function places(document: Tournament) {
  const nodes = document.bracket?.nodes ?? [];
  const final = nodes.find((node) => node.round === 'FINAL');
  const gold = final?.winnerId ?? null;

  return {
    gold,
    silver: (final?.slotA === gold ? final?.slotB : final?.slotA) ?? null,
    bronze: nodes.find((node) => node.round === 'THIRD_PLACE')?.winnerId ?? null,
  };
}

function nameOf(document: Tournament, id: GroupId | null): string {
  const found = document.groups.find((candidate) => candidate.id === id);
  if (found?.name == null) {
    throw new Error('expected a named participant');
  }
  return found.name;
}

function scene(
  snapshot: TournamentSnapshot,
  reveal: { mode: 'AUTO' | 'STEP' | null; step?: number; arriving?: number | null } = {
    mode: null,
  },
) {
  return render(
    <CeremonyScene
      tournament={snapshot}
      settled
      revealMode={reveal.mode}
      revealStep={reveal.step ?? -1}
      arriving={reveal.arriving ?? null}
    />,
  );
}

/** One step of the podium, by the position it stands in: 2 · 1 · 3. */
function place(container: HTMLElement, position: '1' | '2' | '3'): HTMLElement | null {
  return container.querySelector(`[data-podium-place="${position}"]`);
}

function text(container: HTMLElement, position: '1' | '2' | '3'): string {
  return place(container, position)?.textContent ?? '';
}

/** Every animation utility the podium can wear. */
const ANIMATED = '.wm-podium-rise,.wm-podium-name,.wm-podium-gold';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the podium', () => {
  it('puts each name under its own caption', () => {
    const document = played(4);
    const { gold, silver, bronze } = places(document);
    const { container } = scene(toTournamentSnapshot(document));

    // The winner of the `Finale` under `Gold`, its loser under `Silber`, and
    // the winner of the `Spiel um Platz 3` under `Bronze` — the three pairings
    // issue #69 found reversed between silver and bronze.
    expect(text(container, '1')).toContain(nameOf(document, gold));
    expect(text(container, '1')).toContain(de.beamer.ceremony.positions.gold);

    expect(text(container, '2')).toContain(nameOf(document, silver));
    expect(text(container, '2')).toContain(de.beamer.ceremony.positions.silver);

    expect(text(container, '3')).toContain(nameOf(document, bronze));
    expect(text(container, '3')).toContain(de.beamer.ceremony.positions.bronze);

    // And no name stands under a caption that is not its own.
    expect(text(container, '2')).not.toContain(nameOf(document, bronze));
    expect(text(container, '3')).not.toContain(nameOf(document, silver));
  });

  it('keeps the runner-up on the taller block', () => {
    const { container } = scene(toTournamentSnapshot(played(4)));
    const column = (position: '1' | '2' | '3') => place(container, position)?.className ?? '';

    // The geometry was the half of the podium that was right, and neither
    // issue #69's fix nor issue #86's resize may have inverted it: 2 · 1 · 3
    // with the middle on the gold step. Which step is the tallest is not a
    // question about this markup — it is the tokens, and `tokens.test.ts`
    // pins that gold is taller and wider than the two beside it.
    expect(column('1')).toContain('wm-podium-step-gold');
    expect(column('2')).toContain('wm-podium-step-silver');
    expect(column('3')).toContain('wm-podium-step-bronze');
  });

  /*
   * Issue #86. The podium is the last picture of the evening and the one people
   * photograph from the back of a room fifteen metres deep, so the two things
   * it must be are large and unambiguous.
   */
  it('draws the names at the hero step', () => {
    const { container } = scene(toTournamentSnapshot(played(4)));

    for (const position of ['1', '2', '3'] as const) {
      const name = place(container, position)?.querySelector('.wm-display');
      expect(name?.className, position).toContain('text-beamer-hero');
    }
  });

  it('reads out the place on the block itself', () => {
    const { container } = scene(toTournamentSnapshot(played(4)));

    for (const position of ['1', '2', '3'] as const) {
      const number = place(container, position)?.querySelector('.podium-block span');
      // The digit, at the same size as a name: the medal colours alone do not
      // say 1 · 2 · 3 at fifteen metres, and a caption at 24 px does not either.
      expect(number?.textContent, position).toBe(position);
      expect(number?.className, position).toContain('text-beamer-hero');
    }
  });

  it('names an unnamed participant in the words this tournament uses', () => {
    const document = played(4);
    const { gold } = places(document);
    const snapshot = toTournamentSnapshot(document);

    // A `Teams` tournament with somebody who never got a name. Rare by
    // `CEREMONY`, and the scene used to say `Gruppe 3` at it regardless.
    const { container } = scene({
      ...snapshot,
      participantLabel: 'TEAM',
      groups: snapshot.groups.map((entry) =>
        entry.id === gold ? { ...entry, name: null } : entry,
      ),
    });

    const number = document.groups.find((entry) => entry.id === gold)?.number ?? 0;
    expect(text(container, '1')).toContain(de.participant.TEAM.numbered({ n: number }));
    expect(text(container, '1')).not.toContain(de.participant.GROUP.numbered({ n: number }));
  });
});

/*
 * Issue #86's worst case, which is issue #23's: three of the longest names a
 * host can enter, side by side, on the one scene that draws a name at 160 px.
 *
 * The two halves of `@/ui/nameFit` are what has to hold here, and they are
 * asserted as *bounds* rather than as one exact step: the name comes down from
 * the hero step until it fits, it never goes below the 64 px floor this scene
 * sets, and the element it sits in clamps at two lines so anything the floor
 * still cannot hold ends in an ellipsis instead of over the block beside it.
 * A three-line name is the failure the issue names explicitly.
 */
describe('three of the longest names there are', () => {
  /** The example from issue #23's acceptance criteria, at the 40-character limit. */
  const LONG = [
    'Die schnellen Schnitzeljäger aus Salzburg',
    'Die langsamen Schnitzeljäger aus Salzburg',
    'Die mittleren Schnitzeljäger aus Salzburg',
  ];

  function longNamed(): TournamentSnapshot {
    const snapshot = toTournamentSnapshot(played(4));
    return {
      ...snapshot,
      groups: snapshot.groups.map((entry, index) => ({
        ...entry,
        name: LONG[index % LONG.length] ?? entry.name,
      })),
    };
  }

  it('steps every name down to the floor and no further', () => {
    const { container } = scene(longNamed());

    for (const position of ['1', '2', '3'] as const) {
      const name = place(container, position)?.querySelector('.wm-display');
      expect(name?.className, position).toContain('text-beamer-h2');
      // Below the floor is where a name the back of the room cannot read
      // starts, and this is the scene where that name is the whole point.
      expect(name?.className, position).not.toContain('text-beamer-h3');
      expect(name?.className, position).not.toContain('text-beamer-body');
    }
  });

  it('holds the longest name a host can type without an ellipsis', () => {
    // The pair of numbers issue #23's strategy rests on, at this scene's floor:
    // two lines of 64 px hold exactly `MAX_GROUP_NAME_LENGTH` characters, so a
    // name a host can actually enter is read whole. The clamp below is for the
    // longer one only a hand-repaired file can carry.
    expect(NAME_BUDGET['text-beamer-h2'] * 2).toBe(MAX_GROUP_NAME_LENGTH);
    expect(
      fitNameType('x'.repeat(MAX_GROUP_NAME_LENGTH), 'text-beamer-hero', {
        floor: 'text-beamer-h2',
        lines: 2,
      }),
    ).toBe('text-beamer-h2');
  });

  it('clamps a name at two lines rather than letting it grow a third', () => {
    const { container } = scene(longNamed());

    for (const position of ['1', '2', '3'] as const) {
      const name = place(container, position)?.querySelector('.wm-display');
      expect(name?.className, position).toContain('line-clamp-2');
      // And the name is in the markup whole: the clamp is the projector's last
      // resort, not this scene deciding in advance what the room may read.
      expect(LONG, position).toContain(name?.textContent);
    }
  });
});

describe('the reveal the host steps through', () => {
  const document = played(4);
  const { gold, silver, bronze } = places(document);
  const snapshot = toTournamentSnapshot(document);

  /*
   * docs/TOURNAMENT-RULES.md §8: bronze, then silver, then gold, on the host's
   * timing, because they are naming each place out loud before the room sees
   * it. A host who presses *Nächsten Platz zeigen* and gets all three has
   * already given the room the answer.
   */
  it.each([
    [0, ['bronze']],
    [1, ['bronze', 'silver']],
    [2, ['bronze', 'silver', 'gold']],
  ])('shows exactly the places up to step %i', (step, expected) => {
    const { container } = scene(snapshot, { mode: 'STEP', step });
    const shown = new Set(expected);

    for (const [name, position, id] of [
      ['bronze', '3', bronze],
      ['silver', '2', silver],
      ['gold', '1', gold],
    ] as const) {
      const podium = place(container, position);
      expect(podium?.getAttribute('data-revealed')).toBe(String(shown.has(name)));
      // Not merely invisible: a name the host has not said yet is not in the
      // markup at all.
      if (shown.has(name)) {
        expect(podium?.textContent).toContain(nameOf(document, id));
      } else {
        expect(podium?.textContent).not.toContain(nameOf(document, id));
      }
    }
  });

  it('shows nothing at all before the first press', () => {
    const { container } = scene(snapshot, { mode: 'STEP', step: -1 });

    expect(container.textContent).not.toContain(nameOf(document, gold));
    expect(container.textContent).not.toContain(nameOf(document, silver));
    expect(container.textContent).not.toContain(nameOf(document, bronze));
    // The blocks stay, so nothing moves under the names as they arrive.
    expect(place(container, '1')).not.toBeNull();
  });

  it('animates only the place that is landing', () => {
    const { container } = scene(snapshot, { mode: 'STEP', step: 1, arriving: 1 });

    expect(place(container, '2')?.querySelector(ANIMATED)).not.toBeNull();
    expect(place(container, '3')?.querySelector(ANIMATED)).toBeNull();
  });
});

describe('the reveal that runs itself', () => {
  /*
   * The same order, on §4.5's 500 ms timings. Gold is last in both modes — a
   * ceremony that opened with the winner would leave the host announcing two
   * places the room already knew.
   */
  it('reveals bronze, then silver, then gold — never gold first', () => {
    vi.useFakeTimers();
    const document = played(4);
    const { gold, silver, bronze } = places(document);

    const { container } = render(
      <CeremonySceneHost
        tournament={toTournamentSnapshot(document)}
        settled
        delivery="live"
        sceneReveal={{ mode: 'AUTO', step: 0 }}
      />,
    );

    const revealed = () =>
      (['1', '2', '3'] as const)
        .filter((position) => place(container, position)?.getAttribute('data-revealed') === 'true')
        .map((position) => ({ '1': 'gold', '2': 'silver', '3': 'bronze' })[position]);

    expect(revealed()).toEqual(['bronze']);
    expect(container.textContent).not.toContain(nameOf(document, gold));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(revealed()).toEqual(['silver', 'bronze']);
    expect(container.textContent).not.toContain(nameOf(document, gold));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(revealed()).toEqual(['gold', 'silver', 'bronze']);
    expect(container.textContent).toContain(nameOf(document, silver));
    expect(container.textContent).toContain(nameOf(document, bronze));
  });

  /*
   * CLAUDE.md golden rule 4 and §9 case 12: the beamer holds no state of its
   * own, so a window closed mid-ceremony and reopened must come back at the
   * step the host left it on — and must not replay what the room has seen.
   */
  it('comes back at the step the host left it on', () => {
    const document = played(4);
    const { gold, silver } = places(document);

    const { container } = render(
      <CeremonySceneHost
        tournament={toTournamentSnapshot(document)}
        settled
        delivery="catchUp"
        sceneReveal={{ mode: 'STEP', step: 1 }}
      />,
    );

    expect(container.textContent).toContain(nameOf(document, silver));
    expect(container.textContent).not.toContain(nameOf(document, gold));
    expect(container.querySelector(ANIMATED)).toBeNull();
  });

  it('hands a reopened window the finished podium rather than the sequence', () => {
    vi.useFakeTimers();
    const document = played(4);
    const { gold } = places(document);

    const { container } = render(
      <CeremonySceneHost
        tournament={toTournamentSnapshot(document)}
        settled
        delivery="catchUp"
        sceneReveal={{ mode: 'AUTO', step: 0 }}
      />,
    );

    // No timer has run and none needs to: the room watched this happen.
    expect(container.textContent).toContain(nameOf(document, gold));
    expect(container.querySelector(ANIMATED)).toBeNull();
  });
});

describe('a final phase that starts at 2', () => {
  /*
   * docs/TOURNAMENT-RULES.md §9 case 10: at a field of 2 the one match *is* the
   * `Finale` and there is no `Spiel um Platz 3`, so there is no bronze to
   * award.
   */
  it('draws a podium with no bronze step', () => {
    const document = played(2);
    const { gold, silver } = places(document);
    const { container } = scene(toTournamentSnapshot(document));

    expect(place(container, '3')).toBeNull();
    expect(text(container, '1')).toContain(nameOf(document, gold));
    expect(text(container, '2')).toContain(nameOf(document, silver));
    expect(container.textContent).not.toContain(de.beamer.ceremony.positions.bronze);
  });

  it('spends the host’s first press on silver rather than on nothing', () => {
    const document = played(2);
    const { gold, silver } = places(document);
    const { container } = scene(toTournamentSnapshot(document), { mode: 'STEP', step: 0 });

    expect(text(container, '2')).toContain(nameOf(document, silver));
    expect(container.textContent).not.toContain(nameOf(document, gold));
  });
});

describe('the confetti', () => {
  /** jsdom has no `matchMedia`. This is the smallest one that answers. */
  function installReducedMotion(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
  }

  it('is suppressed in performance mode, and the podium still stands complete', () => {
    const document = played(4);
    const { gold } = places(document);
    const { container } = scene({ ...toTournamentSnapshot(document), performanceMode: true });

    expect(container.querySelector('[data-confetti]')).toBeNull();
    expect(text(container, '1')).toContain(nameOf(document, gold));
  });

  it('is suppressed under reduced motion, and the podium still stands complete', () => {
    installReducedMotion(true);
    const document = played(4);
    const { gold } = places(document);
    const { container } = scene(toTournamentSnapshot(document));

    expect(container.querySelector('[data-confetti]')).toBeNull();
    expect(text(container, '1')).toContain(nameOf(document, gold));
  });

  it('waits for gold rather than celebrating an empty podium', () => {
    const snapshot = toTournamentSnapshot(played(4));

    expect(
      scene(snapshot, { mode: 'STEP', step: 1 }).container.querySelector('[data-confetti]'),
    ).toBeNull();
    cleanup();
    expect(
      scene(snapshot, { mode: 'STEP', step: 2 }).container.querySelector('[data-confetti]'),
    ).not.toBeNull();
  });
});
