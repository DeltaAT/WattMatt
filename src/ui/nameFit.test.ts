import { describe, expect, it } from 'vitest';

import { MAX_GROUP_NAME_LENGTH } from '@/domain/naming';
import { fitNameType, NAME_BUDGET } from '@/ui/nameFit';

/**
 * The beamer's truncation strategy (issue #23).
 *
 * The issue asks for the decision to be made here rather than at the first
 * scene that meets a long name: scale down to a floor, then ellipsis. What is
 * pinned below is that both halves hold, and that the floor and the 40-character
 * limit are the same number — which is what makes a legal name always readable
 * whole.
 */

/** The example from the issue's acceptance criteria. */
const LONG_NAME = 'Die schnellen Schnitzeljäger aus Salzburg';

describe('fitNameType', () => {
  it('leaves a short name at the step its card offered', () => {
    expect(fitNameType('Die Adler', 'text-beamer-h2')).toBe('text-beamer-h2');
    expect(fitNameType('Die Adler', 'text-beamer-h3')).toBe('text-beamer-h3');
  });

  it('never steps a name up past the density its scene chose', () => {
    expect(fitNameType('X', 'text-beamer-body')).toBe('text-beamer-body');
    expect(fitNameType('X', 'text-beamer-h3')).toBe('text-beamer-h3');
  });

  it('steps down one size for a name that overflows 64 px', () => {
    const name = 'x'.repeat(NAME_BUDGET['text-beamer-h2'] + 1);
    expect(fitNameType(name, 'text-beamer-h2')).toBe('text-beamer-h3');
  });

  it('steps down to the floor for a name that overflows 48 px too', () => {
    const name = 'x'.repeat(NAME_BUDGET['text-beamer-h3'] + 1);
    expect(fitNameType(name, 'text-beamer-h2')).toBe('text-beamer-body');
  });

  /*
   * 32 px is the floor of docs/STYLEGUIDE.md §2 and the strategy stops there:
   * anything longer is cut by the `truncate` on the element, because a name
   * below the floor cannot be read from the back of the room at all.
   */
  it('stops at the floor and leaves the rest to the ellipsis', () => {
    const name = 'x'.repeat(MAX_GROUP_NAME_LENGTH * 4);
    expect(fitNameType(name, 'text-beamer-h2')).toBe('text-beamer-body');
    expect(fitNameType(name, 'text-beamer-body')).toBe('text-beamer-body');
  });

  /*
   * The pair of numbers the whole strategy rests on: the longest name a host
   * can enter is exactly what the floor holds, so a legal name is never cut.
   */
  it('fits the longest legal name at the floor without an ellipsis', () => {
    expect(NAME_BUDGET['text-beamer-body']).toBe(MAX_GROUP_NAME_LENGTH);
    expect(fitNameType('x'.repeat(MAX_GROUP_NAME_LENGTH), 'text-beamer-h2')).toBe(
      'text-beamer-body',
    );
  });

  it('takes the example from the issue down to the floor', () => {
    expect(LONG_NAME.length).toBeGreaterThan(NAME_BUDGET['text-beamer-h3']);
    expect(fitNameType(LONG_NAME, 'text-beamer-h2')).toBe('text-beamer-body');
  });

  /*
   * The two rungs above 64 px (issue #86). They exist for the one scene where a
   * name *is* the picture rather than a label on a card — the `Siegerehrung` —
   * and the ladder behaves there exactly as it does below: down a step at a
   * time, never up, never past the floor.
   */
  it('steps a hero name down through 96 px before it reaches 64 px', () => {
    const eight = 'x'.repeat(NAME_BUDGET['text-beamer-hero']);
    expect(fitNameType(eight, 'text-beamer-hero')).toBe('text-beamer-hero');
    expect(fitNameType(`${eight}x`, 'text-beamer-hero')).toBe('text-beamer-h1');
    expect(fitNameType('x'.repeat(NAME_BUDGET['text-beamer-h1'] + 1), 'text-beamer-hero')).toBe(
      'text-beamer-h2',
    );
  });

  /*
   * A scene may refuse to go all the way down to 32 px. The podium does: a
   * winner's name at body size is one the back of the room cannot read, and
   * this is the scene that exists to be read from the back of the room.
   */
  it('stops at the floor the scene set, not at 32 px', () => {
    const long = 'x'.repeat(MAX_GROUP_NAME_LENGTH * 4);
    expect(fitNameType(long, 'text-beamer-hero', { floor: 'text-beamer-h2' })).toBe(
      'text-beamer-h2',
    );
    // Unchanged for everybody who does not ask: the default floor is the 32 px
    // of docs/STYLEGUIDE.md §2.
    expect(fitNameType(long, 'text-beamer-hero')).toBe('text-beamer-body');
  });

  it('never inflates a name to reach a floor above the step its scene offered', () => {
    // A floor is the smallest step, not a target. A dense card that asked for
    // 32 px keeps it even if some caller passes a floor two sizes up.
    expect(fitNameType('X', 'text-beamer-body', { floor: 'text-beamer-hero' })).toBe(
      'text-beamer-body',
    );
  });

  /*
   * A second line doubles what a step holds. The podium gives each name a whole
   * column and two lines of it; nothing gives a name three.
   */
  it('counts a second line as twice the budget', () => {
    const name = 'x'.repeat(NAME_BUDGET['text-beamer-hero'] * 2);
    // On one line it is two steps down; on two it stays where the scene put it.
    expect(fitNameType(name, 'text-beamer-hero')).toBe('text-beamer-h2');
    expect(fitNameType(name, 'text-beamer-hero', { lines: 2 })).toBe('text-beamer-hero');
  });

  /*
   * The podium's own pair of numbers (issue #86), the same shape as the pair
   * the floor rests on: two lines of 64 px hold exactly the longest name a host
   * can enter, so the ellipsis is only ever for a hand-repaired file.
   */
  it('holds the longest legal name at the podium floor', () => {
    const podium = { floor: 'text-beamer-h2', lines: 2 } as const;
    expect(NAME_BUDGET['text-beamer-h2'] * 2).toBe(MAX_GROUP_NAME_LENGTH);
    expect(fitNameType('x'.repeat(MAX_GROUP_NAME_LENGTH), 'text-beamer-hero', podium)).toBe(
      'text-beamer-h2',
    );
    expect(fitNameType(LONG_NAME, 'text-beamer-hero', podium)).toBe('text-beamer-h2');
  });

  /*
   * A pairing is two names and the word between them. Stepping down for the
   * longer of the two alone would still overflow the card.
   */
  it('measures the whole line, not one name of it', () => {
    const one = 'x'.repeat(9);
    const other = 'y'.repeat(9);
    // Either name on its own would have stayed at 64 px.
    expect(fitNameType(one, 'text-beamer-h2')).toBe('text-beamer-h2');
    expect(fitNameType(`${one} gegen ${other}`, 'text-beamer-h2')).toBe('text-beamer-h3');
  });
});
