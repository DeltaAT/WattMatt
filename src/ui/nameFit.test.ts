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
