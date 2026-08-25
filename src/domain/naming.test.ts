import { describe, expect, it } from 'vitest';

import {
  isNamingComplete,
  isNamingOpen,
  isValidGroupName,
  MAX_GROUP_NAME_LENGTH,
  namingState,
  normalizeGroupName,
  setGroupName,
} from '@/domain/naming';
import { group, groupId, tournament } from '@/domain/testFixtures';
import type { Group, Tournament } from '@/domain/types';

/**
 * The naming phase (issue #23, docs/TOURNAMENT-RULES.md §6).
 *
 * The edge cases the issue names are the ones tested hardest: a name that is
 * only spaces, one that is one character too long, two participants who are
 * genuinely called the same thing, and a field with gaps in its numbering
 * because half of it has already been knocked out.
 */

/** A tournament with `count` participants, of which `named` have a name. */
function field(count: number, named = 0, overrides: Partial<Tournament> = {}): Tournament {
  const groups: Group[] = Array.from({ length: count }, (_unused, index) =>
    group(index + 1, index < named ? { name: `Name ${index + 1}` } : {}),
  );
  return tournament({ groups, nextGroupNumber: count + 1, ...overrides });
}

describe('normalizeGroupName', () => {
  it('trims, because a trailing space is 64 px wide on the projector', () => {
    expect(normalizeGroupName('  Die Schnellen  ')).toBe('Die Schnellen');
  });

  /*
   * A decomposed umlaut looks identical in the host's field and reaches the
   * projector as a broken glyph — the bundled subset fonts carry no combining
   * marks. Pasting a name is how it gets in.
   */
  it('composes a decomposed umlaut into a single character', () => {
    const decomposed = 'Jäger';
    expect(decomposed.length).toBe(6);

    const normalized = normalizeGroupName(decomposed);
    expect(normalized.length).toBe(5);
    expect(normalized).toBe('Jäger');
    expect(normalized).not.toMatch(/[̀-ͯ]/u);
  });

  /*
   * Composition happens before the length is measured, so a name that is only
   * too long while decomposed is accepted rather than refused for characters
   * the host cannot see.
   */
  it('measures the composed form against the limit', () => {
    const decomposed = `${'a'.repeat(MAX_GROUP_NAME_LENGTH - 1)}ä`;
    expect(decomposed.length).toBe(MAX_GROUP_NAME_LENGTH + 1);
    expect(isValidGroupName(decomposed)).toBe(true);
  });
});

describe('isValidGroupName', () => {
  it('refuses a name that is empty once trimmed', () => {
    expect(isValidGroupName('')).toBe(false);
    expect(isValidGroupName('   ')).toBe(false);
    expect(isValidGroupName('\t\n ')).toBe(false);
  });

  it('accepts exactly 40 characters and refuses 41', () => {
    expect(isValidGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH))).toBe(true);
    expect(isValidGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH + 1))).toBe(false);
  });

  it('counts the trimmed length, not the typed one', () => {
    expect(isValidGroupName(`  ${'x'.repeat(MAX_GROUP_NAME_LENGTH)}  `)).toBe(true);
  });
});

describe('setGroupName', () => {
  it('stores the trimmed name beside the number, which does not change', () => {
    const named = setGroupName(field(4), groupId(2), '  Die Schnellen ');

    const target = named.groups.find((candidate) => candidate.id === groupId(2));
    expect(target?.name).toBe('Die Schnellen');
    expect(target?.number).toBe(2);
  });

  it('leaves every other participant alone', () => {
    const before = field(4);
    const after = setGroupName(before, groupId(2), 'Die Schnellen');

    expect(after.groups.filter((candidate) => candidate.name !== null)).toHaveLength(1);
    expect(after.groups[0]).toBe(before.groups[0]);
  });

  /* The typo that surfaces at 64 px has to be fixable in place (§6). */
  it('corrects a name that is already there', () => {
    const named = setGroupName(field(4), groupId(1), 'Die Schnelen');
    const corrected = setGroupName(named, groupId(1), 'Die Schnellen');

    expect(corrected.groups[0]?.name).toBe('Die Schnellen');
  });

  it('refuses an empty or over-long name and hands the tournament back', () => {
    const before = field(4);

    expect(setGroupName(before, groupId(1), '   ')).toBe(before);
    expect(setGroupName(before, groupId(1), 'x'.repeat(MAX_GROUP_NAME_LENGTH + 1))).toBe(before);
  });

  it('refuses a group that is not in the tournament', () => {
    const before = field(4);
    expect(setGroupName(before, groupId(99), 'Die Schnellen')).toBe(before);
  });

  it('commits nothing when the name did not actually change', () => {
    const before = setGroupName(field(4), groupId(1), 'Die Schnellen');
    expect(setGroupName(before, groupId(1), '  Die Schnellen  ')).toBe(before);
  });

  /*
   * A participant who has lost still appears in the round history the host puts
   * back on the projector, so their name has to stay correctable.
   */
  it('names a group that has already been eliminated', () => {
    const before = tournament({ groups: [group(1, { status: 'ELIMINATED' })] });
    const after = setGroupName(before, groupId(1), 'Die Schnellen');

    expect(after.groups[0]?.name).toBe('Die Schnellen');
  });
});

describe('isNamingOpen', () => {
  it('is open once the field has fallen to the threshold', () => {
    expect(isNamingOpen(field(17))).toBe(false);
    expect(isNamingOpen(field(16))).toBe(true);
  });

  /* docs/OPEN-QUESTIONS.md #63: the threshold decides, not the phase. */
  it('opens in whichever phase the field reaches the threshold in', () => {
    const small = field(8, 0, { phase: 'SETUP' });
    expect(small.settings.namingAt).toBe(16);
    expect(isNamingOpen(small)).toBe(true);
  });

  it('follows a threshold the host has moved', () => {
    const many = field(32);
    expect(isNamingOpen(many)).toBe(false);
    expect(isNamingOpen({ ...many, settings: { ...many.settings, namingAt: 64 } })).toBe(true);
  });

  it('counts only the participants who are still in', () => {
    const twenty = field(20);
    const halfOut = {
      ...twenty,
      groups: twenty.groups.map((candidate, index) =>
        index < 8 ? { ...candidate, status: 'ELIMINATED' as const } : candidate,
      ),
    };

    expect(isNamingOpen(halfOut)).toBe(true);
  });

  it('is closed while there is nobody to name', () => {
    expect(isNamingOpen(tournament())).toBe(false);
  });
});

describe('isNamingComplete', () => {
  it('is false while a remaining participant has no name', () => {
    expect(isNamingComplete(field(4, 3))).toBe(false);
  });

  it('is true once every remaining participant has one', () => {
    expect(isNamingComplete(field(4, 4))).toBe(true);
  });

  /*
   * A participant knocked out in round one was never asked for a name, and
   * must not hold the final phase up.
   */
  it('ignores participants who are already out', () => {
    const four = field(4, 2);
    const halfOut = {
      ...four,
      groups: four.groups.map((candidate, index) =>
        index >= 2 ? { ...candidate, status: 'ELIMINATED' as const } : candidate,
      ),
    };

    expect(isNamingComplete(halfOut)).toBe(true);
  });
});

describe('namingState', () => {
  it('is null while names are not being asked for', () => {
    expect(namingState(field(17))).toBeNull();
  });

  it('counts the names entered against the field, for "12 von 16"', () => {
    const state = namingState(field(16, 12));

    expect(state?.named).toBe(12);
    expect(state?.total).toBe(16);
    expect(state?.complete).toBe(false);
  });

  it('is complete once every row has a name', () => {
    expect(namingState(field(16, 16))?.complete).toBe(true);
  });

  /*
   * Numbers are never reused and never shift (§0, §9 case 9), so the list a
   * host works down has gaps in it. Ordering by number is what keeps their eye
   * on the right row.
   */
  it('lists the remaining participants by number, gaps included', () => {
    const eight = field(8);
    const survivors = {
      ...eight,
      groups: eight.groups.map((candidate) =>
        [2, 3, 6].includes(candidate.number)
          ? candidate
          : { ...candidate, status: 'ELIMINATED' as const },
      ),
    };

    expect(namingState(survivors)?.entries.map((entry) => entry.number)).toEqual([2, 3, 6]);
  });

  it('orders by number even when the group list does not', () => {
    const shuffled = tournament({
      groups: [group(7), group(2), group(5)],
      nextGroupNumber: 8,
    });

    expect(namingState(shuffled)?.entries.map((entry) => entry.number)).toEqual([2, 5, 7]);
  });

  /* Duplicates are allowed — two teams may genuinely share a name (§6). */
  it('flags both participants of a duplicated name without refusing either', () => {
    const named = setGroupName(
      setGroupName(field(4), groupId(1), 'Die Adler'),
      groupId(3),
      'Die Adler',
    );
    const state = namingState(named);

    expect(state?.duplicates).toBe(2);
    expect(state?.entries.map((entry) => entry.isDuplicate)).toEqual([true, false, true, false]);
    expect(state?.entries[0]?.name).toBe('Die Adler');
    expect(state?.entries[2]?.name).toBe('Die Adler');
  });

  it('sees through a difference of case, which is how the collision happens', () => {
    const named = setGroupName(
      setGroupName(field(4), groupId(1), 'Die Adler'),
      groupId(2),
      'die adler',
    );

    expect(namingState(named)?.duplicates).toBe(2);
  });

  it('reports no duplicate when the names differ', () => {
    const named = setGroupName(
      setGroupName(field(4), groupId(1), 'Die Adler'),
      groupId(2),
      'Die Falken',
    );

    expect(namingState(named)?.duplicates).toBe(0);
  });

  /* Two empty rows are not two participants with the same name. */
  it('does not treat missing names as duplicates of each other', () => {
    expect(namingState(field(4))?.duplicates).toBe(0);
  });

  it('does not count a name shared with somebody who is already out', () => {
    const two = tournament({
      groups: [
        group(1, { name: 'Die Adler' }),
        group(2, { name: 'Die Adler', status: 'ELIMINATED' }),
      ],
      nextGroupNumber: 3,
    });

    expect(namingState(two)?.duplicates).toBe(0);
  });
});
