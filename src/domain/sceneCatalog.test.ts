import { describe, expect, it } from 'vitest';

import { isSameScene, type BeamerSceneId } from '@/domain/beamerScene';
import { SCENE_ORDER, sceneChoices, sceneForPhase, stagedRound } from '@/domain/sceneCatalog';
import { round, roundId, tournament } from '@/domain/testFixtures';

describe('the round a scene is staged against', () => {
  it('is the open round while one is open', () => {
    const open = round(2, { state: 'RUNNING' });
    const document = tournament({ rounds: [round(1, { state: 'CLOSED' }), open] });

    expect(stagedRound(document)?.id).toBe(open.id);
  });

  /*
   * The host between two rounds is pointing the room at the round that just
   * finished, not at nothing.
   */
  it('falls back to the most recent closed round between rounds', () => {
    const document = tournament({
      rounds: [round(1, { state: 'CLOSED' }), round(2, { state: 'CLOSED' })],
    });

    expect(stagedRound(document)?.id).toBe(roundId(2));
  });

  it('is null before anything has been drawn', () => {
    expect(stagedRound(tournament())).toBeNull();
  });
});

describe('the scene a phase implies', () => {
  it('welcomes the room during setup', () => {
    // The half hour in which people arrive and register is the longest stretch
    // the projector is on, and the welcome count is what it is for (issue #74).
    expect(sceneForPhase(tournament({ phase: 'SETUP' }))).toEqual({ id: 'WELCOME' });
  });

  it('shows the board of the round in play, not the draw of it', () => {
    const open = round(3, { state: 'RUNNING' });
    const document = tournament({ phase: 'QUALIFYING', rounds: [open] });

    expect(sceneForPhase(document)).toEqual({ id: 'ROUND_BOARD', roundId: open.id });
  });

  it('does the same in the elimination rounds', () => {
    const open = round(4, { state: 'DRAWN', kind: 'ELIMINATION' });
    const document = tournament({ phase: 'ELIMINATION', rounds: [open] });

    expect(sceneForPhase(document)).toEqual({ id: 'ROUND_BOARD', roundId: open.id });
  });

  /*
   * The edge case the host reaches by stepping into a phase before drawing it:
   * a board with no round is a picture that cannot be built, and the idle
   * screen is the honest one.
   */
  it('stays idle in a round phase that has no round yet', () => {
    expect(sceneForPhase(tournament({ phase: 'QUALIFYING' }))).toEqual({ id: 'IDLE' });
  });

  it('maps the three phases that are one picture each', () => {
    expect(sceneForPhase(tournament({ phase: 'REPECHAGE' }))).toEqual({ id: 'REPECHAGE' });
    expect(sceneForPhase(tournament({ phase: 'NAMING' }))).toEqual({ id: 'NAMING' });
    expect(sceneForPhase(tournament({ phase: 'CEREMONY' }))).toEqual({ id: 'CEREMONY' });
  });

  /*
   * The whole tree, never a focused round: focusing is a decision the host
   * takes by hand, and auto-follow must not guess which two matches they were
   * about to talk about (issue #26).
   */
  it('stages the whole tree in the final phase', () => {
    expect(sceneForPhase(tournament({ phase: 'BRACKET' }))).toEqual({ id: 'BRACKET' });
  });
});

describe('the scene switcher', () => {
  it('offers the same nine positions whatever the tournament is doing', () => {
    const empty = sceneChoices(null).map((choice) => choice.id);
    const running = sceneChoices(tournament({ phase: 'BRACKET', rounds: [round(1)] })).map(
      (choice) => choice.id,
    );

    expect(empty).toEqual([...SCENE_ORDER]);
    expect(running).toEqual([...SCENE_ORDER]);
    // The position is the shortcut, so it has to be 1…9 and stay there.
    expect(sceneChoices(null).map((choice) => choice.shortcut)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  /*
   * The panic button is not one picture among ten. It sits in the same place
   * whatever else the switcher is showing (docs/MOTION.md §4.6).
   */
  it('never lists the blackout among the numbered scenes', () => {
    expect(SCENE_ORDER).not.toContain<BeamerSceneId>('BLACKOUT');
  });

  /*
   * Issue #74's last task: the welcome picture is reachable by hand at any
   * time. It takes position 1 rather than a tenth one — the digits stop at 9
   * (`useBeamerShortcuts`) — and `IDLE`, which it was written to replace, is
   * the scene it takes it from. `IDLE` remains a descriptor the app stages on
   * its own for the moments no tournament is open.
   */
  it('offers the welcome picture at position 1, in place of the idle one', () => {
    expect(SCENE_ORDER[0]).toBe<BeamerSceneId>('WELCOME');
    expect(SCENE_ORDER).not.toContain<BeamerSceneId>('IDLE');

    const welcome = sceneChoices(null).find((choice) => choice.id === 'WELCOME');
    expect(welcome?.shortcut).toBe(1);
    // Reachable before a tournament is even open, like every scene that does
    // not name a round (CLAUDE.md golden rule 3).
    expect(welcome?.scene).toEqual({ id: 'WELCOME' });
  });

  it('points the two round scenes at the round the host means', () => {
    const open = round(2, { state: 'RUNNING' });
    const choices = sceneChoices(tournament({ rounds: [round(1, { state: 'CLOSED' }), open] }));

    expect(choices.find((choice) => choice.id === 'DRAW')?.scene).toEqual({
      id: 'DRAW',
      roundId: open.id,
    });
    expect(choices.find((choice) => choice.id === 'ROUND_BOARD')?.scene).toEqual({
      id: 'ROUND_BOARD',
      roundId: open.id,
    });
  });

  /*
   * "Any scene is reachable within one click at any time, in any phase" — with
   * the one exception that is not a scene at all. A `DRAW` before anything has
   * been drawn names a round that does not exist.
   */
  it('withholds only the two scenes that need a round, and only until there is one', () => {
    const unavailable = sceneChoices(tournament())
      .filter((choice) => choice.scene === null)
      .map((choice) => choice.id);

    expect(unavailable).toEqual(['DRAW', 'ROUND_BOARD']);

    const drawn = sceneChoices(tournament({ rounds: [round(1)] }));
    expect(drawn.every((choice) => choice.scene !== null)).toBe(true);
  });

  it('offers every scene before a tournament is even open', () => {
    const choices = sceneChoices(null);

    // The beamer is never hostage to whether a tournament happens to be open
    // (CLAUDE.md golden rule 3) — bar the two that name a round.
    expect(choices.filter((choice) => choice.scene !== null)).toHaveLength(SCENE_ORDER.length - 2);
  });

  it('produces descriptors the beamer recognises as the picture it is showing', () => {
    for (const choice of sceneChoices(tournament({ rounds: [round(1)] }))) {
      expect(choice.scene).not.toBeNull();
      expect(isSameScene(choice.scene!, choice.scene!)).toBe(true);
    }
  });
});
