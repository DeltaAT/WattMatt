import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import { tableNumber } from '@/windows/tableLabel';

/**
 * How a table is named on the beamer (issue #75).
 *
 * The word `Tisch` printed over every section of the board is the width the
 * numerals under it could have had, and the number alone is unambiguous on a
 * screen whose subject is which table to walk to. What must not happen is the
 * other half: a label the host wrote themselves being second-guessed, so that
 * the wall says something nobody in the hall is calling that table.
 */

describe('tableNumber', () => {
  it('drops the word from the label a table is created with', () => {
    expect(tableNumber(de.table.defaultLabel({ n: 1 }))).toBe('1');
    expect(tableNumber(de.table.defaultLabel({ n: 12 }))).toBe('12');
  });

  it('keeps a label the host wrote themselves, whatever it says', () => {
    expect(tableNumber('Fenster')).toBe('Fenster');
    expect(tableNumber('Bühne links')).toBe('Bühne links');
    expect(tableNumber('A')).toBe('A');
  });

  /*
   * The two ways a label can start with the word and not be a numbered one.
   * Both are labels the host meant literally, and neither leaves anything
   * behind worth showing instead.
   */
  it('leaves the bare word and a longer word that starts with it alone', () => {
    expect(tableNumber(de.table.label)).toBe(de.table.label);
    expect(tableNumber('Tischtennis')).toBe('Tischtennis');
  });

  it('keeps whatever the host wrote after the word, not only a number', () => {
    // Renaming to "Tisch A" is a thing hosts do at a venue that letters its
    // tables, and the letter is what the room is looking for.
    expect(tableNumber(`${de.table.label} A`)).toBe('A');
  });

  it('never returns an empty label, whatever it is handed', () => {
    // A card with nothing where the table goes is a card the room reads as
    // broken. `tableSchema` already refuses an empty label; this is the belt.
    expect(tableNumber(`${de.table.label} `)).toBe(`${de.table.label} `);
  });
});
