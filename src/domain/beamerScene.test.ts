import { describe, expect, it } from 'vitest';

import { beamerSceneSchema, isSameScene, type BeamerScene } from '@/domain/beamerScene';
import { roundIdSchema } from '@/domain/ids';

const round = (value: string) => roundIdSchema.parse(value);

describe('the beamer scene contract', () => {
  it('accepts every scene named in ARCHITECTURE.md §3', () => {
    const scenes: BeamerScene[] = [
      { id: 'IDLE' },
      { id: 'WELCOME' },
      { id: 'BLACKOUT' },
      { id: 'GROUP_OVERVIEW' },
      { id: 'TABLE_OVERVIEW' },
      { id: 'DRAW', roundId: round('r1') },
      { id: 'ROUND_BOARD', roundId: round('r1') },
      { id: 'ROUND_BOARD', roundId: round('r1'), split: true },
      { id: 'REPECHAGE' },
      { id: 'NAMING' },
      { id: 'BRACKET' },
      { id: 'CEREMONY' },
    ];

    for (const scene of scenes) {
      expect(beamerSceneSchema.parse(scene)).toEqual(scene);
    }
  });

  it('refuses a round-bound scene that carries no round', () => {
    // The union is what stops a DRAW without a round reaching the beamer and
    // rendering an empty pairing table in front of the room.
    expect(beamerSceneSchema.safeParse({ id: 'DRAW' }).success).toBe(false);
    expect(beamerSceneSchema.safeParse({ id: 'ROUND_BOARD', roundId: '' }).success).toBe(false);
  });

  it('refuses a scene id it does not know', () => {
    expect(beamerSceneSchema.safeParse({ id: 'PODIUM' }).success).toBe(false);
  });
});

describe('isSameScene', () => {
  it('separates two rounds of the same scene', () => {
    // Round 2's board must animate in even though round 1's board was already
    // on screen; treating them as one picture would freeze the beamer on the
    // previous round.
    expect(
      isSameScene(
        { id: 'ROUND_BOARD', roundId: round('r1') },
        { id: 'ROUND_BOARD', roundId: round('r2') },
      ),
    ).toBe(false);
  });

  it('recognises a re-delivered scene so it is not animated twice', () => {
    expect(
      isSameScene({ id: 'DRAW', roundId: round('r1') }, { id: 'DRAW', roundId: round('r1') }),
    ).toBe(true);
    expect(isSameScene({ id: 'IDLE' }, { id: 'IDLE' })).toBe(true);
    // Which is what keeps the welcome screen from re-entering every time the
    // host adds a group: the scene has not changed, only the count on it.
    expect(isSameScene({ id: 'WELCOME' }, { id: 'WELCOME' })).toBe(true);
  });

  /*
   * Splitting the wall in two is a different picture, and the beamer animates
   * into it rather than cutting to it (issue #79).
   */
  it('separates a split round board from the single one', () => {
    const single = { id: 'ROUND_BOARD', roundId: round('r1') } as const;

    expect(isSameScene(single, { ...single, split: true })).toBe(false);
    expect(isSameScene({ ...single, split: true }, { ...single, split: true })).toBe(true);
    // An absent flag and an explicit `false` are the same picture, so a scene
    // built either way is not re-animated into itself.
    expect(isSameScene(single, { ...single, split: false })).toBe(true);
  });

  it('separates different scene ids', () => {
    expect(isSameScene({ id: 'IDLE' }, { id: 'BLACKOUT' })).toBe(false);
    // The welcome picture and the idle one are two scenes, not one dressed
    // differently: staging either must animate in over the other (issue #74).
    expect(isSameScene({ id: 'WELCOME' }, { id: 'IDLE' })).toBe(false);
    expect(isSameScene({ id: 'BRACKET' }, { id: 'DRAW', roundId: round('r1') })).toBe(false);
  });
});
