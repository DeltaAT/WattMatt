import { describe, expect, it } from 'vitest';

import { beamerSceneSchema, isSameScene, type BeamerScene } from '@/domain/beamerScene';
import { roundIdSchema } from '@/domain/ids';

const round = (value: string) => roundIdSchema.parse(value);

describe('the beamer scene contract', () => {
  it('accepts every scene named in ARCHITECTURE.md §3', () => {
    const scenes: BeamerScene[] = [
      { id: 'IDLE' },
      { id: 'BLACKOUT' },
      { id: 'GROUP_OVERVIEW' },
      { id: 'TABLE_OVERVIEW' },
      { id: 'DRAW', roundId: round('r1') },
      { id: 'ROUND_BOARD', roundId: round('r1') },
      { id: 'REPECHAGE', roundId: round('r1') },
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
  });

  it('separates different scene ids', () => {
    expect(isSameScene({ id: 'IDLE' }, { id: 'BLACKOUT' })).toBe(false);
    expect(isSameScene({ id: 'BRACKET' }, { id: 'DRAW', roundId: round('r1') })).toBe(false);
  });
});
