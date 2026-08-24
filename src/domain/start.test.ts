import { describe, expect, it } from 'vitest';

import { preStartReport, previewFirstRound, startTournament } from '@/domain/start';
import { group, table, tournament } from '@/domain/testFixtures';
import type { Group, Table, Tournament } from '@/domain/types';

/**
 * The gate between setup and a running tournament (issue #15).
 *
 * The checks exist so a problem is found while it can still be fixed by
 * carrying a table in or asking one more person to play — not in front of an
 * audience. So every case below is a room, not an abstraction: nobody has
 * signed up yet, every table is out of service, thirteen people and three
 * tables.
 */

function ready(overrides: Partial<Tournament> = {}): Tournament {
  return tournament({ groups: [group(1), group(2)], tables: [table(1)], ...overrides });
}

function groups(n: number): Group[] {
  return Array.from({ length: n }, (_unused, index) => group(index + 1));
}

function tables(n: number, overrides: Partial<Table> = {}): Table[] {
  return Array.from({ length: n }, (_unused, index) => table(index + 1, overrides));
}

describe('previewFirstRound', () => {
  /* docs/TOURNAMENT-RULES.md §3: shuffle, pair, and the odd one out gets a bye. */
  it.each([
    [2, 1, false],
    [3, 1, true],
    [5, 2, true],
    [13, 6, true],
    [40, 20, false],
    [64, 32, false],
  ])('pairs %i participants into %i matches (bye: %s)', (n, matches, bye) => {
    const preview = previewFirstRound(ready({ groups: groups(n), tables: tables(4) }));

    expect(preview.participants).toBe(n);
    expect(preview.matches).toBe(matches);
    expect(preview.bye).toBe(bye);
  });

  /* Only `ACTIVE` groups are drawn — the `P` of §3 — so an eliminated one must
   * not be counted into a pairing it will never be in. */
  it('counts only the participants still in the tournament', () => {
    const preview = previewFirstRound(
      ready({ groups: [group(1), group(2), group(3, { status: 'ELIMINATED' })] }),
    );

    expect(preview.participants).toBe(2);
    expect(preview.matches).toBe(1);
    expect(preview.bye).toBe(false);
  });

  /* A `gesperrt` table is never offered a match (docs/TOURNAMENT-RULES.md §0),
   * so it cannot count towards the tables the round has. */
  it('does not count a table that is out of service', () => {
    const preview = previewFirstRound(
      ready({
        groups: groups(4),
        tables: [table(1), table(2, { status: 'DISABLED' })],
      }),
    );

    expect(preview.tables).toBe(1);
    expect(preview.queued).toBe(1);
  });

  /* An occupied table is not free *now*, but it is a playing surface: it frees
   * up the moment its match is decided. */
  it('counts a busy table, which will free up', () => {
    const preview = previewFirstRound(ready({ groups: groups(4), tables: tables(2) }));

    expect(preview.tables).toBe(2);
    expect(preview.queued).toBe(0);
  });

  it('never reports a negative queue when there are more tables than matches', () => {
    expect(previewFirstRound(ready({ groups: groups(2), tables: tables(8) })).queued).toBe(0);
  });
});

describe('preStartReport', () => {
  it('lets a tournament with two participants and one table start', () => {
    const report = preStartReport(ready());

    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.canStart).toBe(true);
  });

  /* The issue's first acceptance criterion: one group can never start, and the
   * reason is named rather than left as a dead button. */
  it.each([0, 1])('blocks a tournament with %i participants', (n) => {
    const report = preStartReport(ready({ groups: groups(n) }));

    expect(report.blockers).toContain('TOO_FEW_GROUPS');
    expect(report.canStart).toBe(false);
  });

  it('blocks a tournament with no table at all', () => {
    const report = preStartReport(ready({ tables: [] }));

    expect(report.blockers).toContain('NO_USABLE_TABLE');
    expect(report.canStart).toBe(false);
  });

  /* "At least one *usable* table": a room whose only table has a wobbly leg is
   * a room that cannot play, and the count alone would not say so. */
  it('blocks a tournament whose every table is out of service', () => {
    const report = preStartReport(ready({ tables: tables(3, { status: 'DISABLED' }) }));

    expect(report.blockers).toContain('NO_USABLE_TABLE');
    expect(report.canStart).toBe(false);
  });

  it('names both blockers at once when the tournament is empty', () => {
    const report = preStartReport(tournament());

    expect(report.blockers).toEqual(['TOO_FEW_GROUPS', 'NO_USABLE_TABLE']);
  });

  /* A shortage is a warning and never a block — the host decides whether they
   * mind the queue (CLAUDE.md golden rule 3). */
  it('warns about a long queue without blocking the start', () => {
    const report = preStartReport(ready({ groups: groups(40), tables: tables(3) }));

    expect(report.warnings).toEqual(['TABLE_SHORTAGE']);
    expect(report.blockers).toEqual([]);
    expect(report.canStart).toBe(true);
    expect(report.preview.queued).toBe(17);
  });

  /* Two sittings is an ordinary evening and must not nag; three is the point
   * where the host would still carry another table in. */
  it('stays quiet while the tables only have to turn over twice', () => {
    expect(preStartReport(ready({ groups: groups(8), tables: tables(2) })).warnings).toEqual([]);
  });

  it('warns once the tables have to turn over more than twice', () => {
    expect(preStartReport(ready({ groups: groups(10), tables: tables(2) })).warnings).toEqual([
      'TABLE_SHORTAGE',
    ]);
  });

  /* With no table the blocker already says the important thing; a second line
   * about the same missing table would be noise. */
  it('does not add a shortage warning to a tournament with no tables', () => {
    expect(preStartReport(ready({ groups: groups(40), tables: [] })).warnings).toEqual([]);
  });

  it('reports a started tournament as no longer pending', () => {
    const report = preStartReport(ready({ phase: 'QUALIFYING' }));

    expect(report.pending).toBe(false);
    expect(report.canStart).toBe(false);
    expect(report.blockers).toEqual([]);
  });
});

describe('startTournament', () => {
  it('moves a ready tournament from SETUP into QUALIFYING', () => {
    expect(startTournament(ready()).phase).toBe('QUALIFYING');
  });

  /* The phase and nothing else: drawing the round is issue #16's, and a start
   * that also drew would put pairings on the projector the instant it is
   * clicked (docs/TOURNAMENT-RULES.md §1). */
  it('changes nothing but the phase', () => {
    const before = ready();

    const after = startTournament(before);

    expect({ ...after, phase: before.phase }).toEqual(before);
    expect(after.rounds).toEqual([]);
  });

  it.each([
    ['one participant', ready({ groups: groups(1) })],
    ['no usable table', ready({ tables: tables(1, { status: 'DISABLED' }) })],
  ])('refuses a tournament with %s', (_case, before) => {
    expect(startTournament(before)).toBe(before);
  });

  /* A stale click must not push a running tournament through the transition a
   * second time. */
  it('refuses a tournament that has already started', () => {
    const before = ready({ phase: 'QUALIFYING' });

    expect(startTournament(before)).toBe(before);
  });
});
