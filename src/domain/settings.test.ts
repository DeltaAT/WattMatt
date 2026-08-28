import { describe, expect, it } from 'vitest';

import {
  isNamingAtEditable,
  isValidNamingAt,
  MINIMUM_NAMING_AT,
  setNamingAt,
  setParticipantLabel,
  setPerformanceMode,
  setTableAssignmentOrder,
  setTournamentName,
} from '@/domain/settings';
import { midTournament, tournament } from '@/domain/testFixtures';

/**
 * The tournament's own settings (issue #14).
 *
 * `participantLabel` decides one thing and nothing else: which German noun the
 * host and the audience read. The point of the test is that it really is
 * nothing else — a setting that quietly rewrote the field would be discovered
 * mid-event.
 */

describe('setParticipantLabel', () => {
  it('switches the wording the whole app reads', () => {
    expect(setParticipantLabel(tournament(), 'TEAM').settings.participantLabel).toBe('TEAM');
  });

  it('changes nothing else about the tournament', () => {
    const before = midTournament();

    const after = setParticipantLabel(before, 'PLAYER');

    expect({ ...after, settings: before.settings }).toEqual(before);
    expect(after.groups).toBe(before.groups);
  });

  /* A no-op must not commit: it would put a step on the undo stack that undoes
   * nothing and dirty a file that is on disk (see `@/store/actions/groups`). */
  it('hands the tournament straight back when the wording is already that', () => {
    const before = tournament();

    expect(setParticipantLabel(before, 'GROUP')).toBe(before);
  });
});

/**
 * The rest of the settings, and the tournament's name (issue #15).
 *
 * Two properties matter for all of them and are checked one by one: a value
 * that cannot be stored is refused rather than written — the file has to reopen
 * — and a change that changes nothing hands the same object back, because
 * committing a no-op puts a step on the undo stack that undoes nothing.
 */

describe('setTournamentName', () => {
  it('renames the tournament', () => {
    expect(setTournamentName(tournament(), 'Vereinsturnier 2026').name).toBe('Vereinsturnier 2026');
  });

  it('trims what the host typed', () => {
    expect(setTournamentName(tournament(), '  Herbstturnier \n').name).toBe('Herbstturnier');
  });

  /* `tournamentSchema` requires a non-empty name: storing one would write a
   * file that cannot be opened again. */
  it.each(['', '   ', '\t\n'])('refuses the empty name %j', (name) => {
    const before = tournament();

    expect(setTournamentName(before, name)).toBe(before);
  });

  it('hands the tournament back when the trimmed name is the current one', () => {
    const before = tournament({ name: 'Sommerturnier' });

    expect(setTournamentName(before, '  Sommerturnier  ')).toBe(before);
  });

  /* The file keeps the name it was created under (docs/OPEN-QUESTIONS.md #26):
   * renaming the event must not move the bytes autosave is writing into. */
  it('changes nothing else about the tournament', () => {
    const before = midTournament();

    const after = setTournamentName(before, 'Anders');

    expect({ ...after, name: before.name }).toEqual(before);
  });
});

describe('setNamingAt', () => {
  it('moves the threshold at which names are required', () => {
    expect(setNamingAt(tournament(), 8).settings.namingAt).toBe(8);
  });

  /* "Names from the start" is the case docs/OPEN-QUESTIONS.md #8 names: a
   * threshold above 16 is legitimate, not a typo to clamp. */
  it('accepts a threshold larger than the default field of 16', () => {
    expect(setNamingAt(tournament(), 40).settings.namingAt).toBe(40);
  });

  it.each([1, 0, -8, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %j, which is not a field size',
    (namingAt) => {
      const before = tournament();

      expect(setNamingAt(before, namingAt)).toBe(before);
      expect(isValidNamingAt(namingAt)).toBe(false);
    },
  );

  it('accepts the smallest field there is, which is the final', () => {
    expect(MINIMUM_NAMING_AT).toBe(2);
    expect(setNamingAt(tournament(), MINIMUM_NAMING_AT).settings.namingAt).toBe(2);
  });

  it('hands the tournament back when the threshold is already that', () => {
    const before = tournament();

    expect(setNamingAt(before, before.settings.namingAt)).toBe(before);
  });

  /*
   * Editable for the whole tournament up to the naming phase — the host runs
   * their event — and locked from `NAMING` on, where moving the line would
   * either demand names nobody was asked for or leave a bracket half-named.
   */
  it.each(['SETUP', 'QUALIFYING', 'REPECHAGE', 'ELIMINATION'] as const)(
    'is still editable in %s',
    (phase) => {
      const before = tournament({ phase });

      expect(isNamingAtEditable(before)).toBe(true);
      expect(setNamingAt(before, 8).settings.namingAt).toBe(8);
    },
  );

  it.each(['NAMING', 'BRACKET', 'CEREMONY'] as const)('is locked in %s', (phase) => {
    const before = tournament({ phase });

    expect(isNamingAtEditable(before)).toBe(false);
    expect(setNamingAt(before, 8)).toBe(before);
  });
});

describe('setPerformanceMode', () => {
  it('turns the mode on and off again', () => {
    const on = setPerformanceMode(tournament(), true);

    expect(on.settings.performanceMode).toBe(true);
    expect(setPerformanceMode(on, false).settings.performanceMode).toBe(false);
  });

  /*
   * docs/MOTION.md §6: the host reaches for this because the projector is
   * stuttering *now*, which is always mid-event. It is the one setting no phase
   * may lock.
   */
  it.each([
    'SETUP',
    'QUALIFYING',
    'REPECHAGE',
    'ELIMINATION',
    'NAMING',
    'BRACKET',
    'CEREMONY',
  ] as const)('is reachable in %s', (phase) => {
    expect(setPerformanceMode(tournament({ phase }), true).settings.performanceMode).toBe(true);
  });

  it('hands the tournament back when the mode is already that', () => {
    const before = tournament();

    expect(setPerformanceMode(before, false)).toBe(before);
  });
});

/**
 * Which end of the table list free tables are handed out from (issue #101).
 *
 * Where the direction is *applied* is `freeTables` and the tests around the
 * draw; what matters here is the same claim every other setting makes — it
 * decides one thing and touches nothing else. This one is worth stating
 * plainly, because the thing it must not touch is a match a room is watching.
 */
describe('setTableAssignmentOrder', () => {
  it('records the direction the host chose', () => {
    expect(setTableAssignmentOrder(tournament(), 'DESCENDING').settings.tableAssignmentOrder).toBe(
      'DESCENDING',
    );
  });

  it('starts out filling from the first table', () => {
    expect(tournament().settings.tableAssignmentOrder).toBe('ASCENDING');
  });

  /*
   * The rule this setting shares with `reserveTable`: it changes what happens
   * next and never what is happening. A tournament mid-event has a match on a
   * table and a bracket on the wall, and neither may move because the host
   * pointed the next assignment at the other end of the hall.
   */
  it('changes nothing else about a tournament that is under way', () => {
    const before = midTournament();

    const after = setTableAssignmentOrder(before, 'DESCENDING');

    expect({ ...after, settings: before.settings }).toEqual(before);
    expect(after.tables).toBe(before.tables);
    expect(after.rounds).toBe(before.rounds);
  });

  /* A no-op must not commit, for the reason `setParticipantLabel` gives: a step
   * on the undo stack that undoes nothing, and a saved file marked dirty. */
  it('hands the tournament straight back when it is already that direction', () => {
    const before = tournament();

    expect(setTableAssignmentOrder(before, 'ASCENDING')).toBe(before);
  });

  /* Never locked by the phase. The host carries two more tables in during the
   * quarter-finals, and the setting is exactly as usable then. */
  it('is allowed at any phase', () => {
    const late = midTournament();

    expect(setTableAssignmentOrder(late, 'DESCENDING').settings.tableAssignmentOrder).toBe(
      'DESCENDING',
    );
  });
});
