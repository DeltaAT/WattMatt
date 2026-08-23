import { describe, expect, it } from 'vitest';

import { groupIdSchema } from '@/domain/ids';
import { INITIAL_SNAPSHOT, snapshotSchema, supersedes, type Snapshot } from '@/domain/snapshot';

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...INITIAL_SNAPSHOT, ...overrides };
}

describe('the snapshot envelope', () => {
  it('survives a round trip through the wire format', () => {
    const sent = snapshot({
      revision: 7,
      scene: { id: 'BRACKET' },
      tournament: {
        groups: [
          {
            id: groupIdSchema.parse('g1'),
            number: 1,
            name: 'Die Rasenden',
            status: 'ACTIVE',
          },
        ],
      },
      delivery: 'live',
    });

    // This is the actual boundary: a payload leaves as JSON and must come back
    // as the same value, not merely as something that parses.
    const received = snapshotSchema.parse(JSON.parse(JSON.stringify(sent)));

    expect(received).toEqual(sent);
  });

  it('rejects a payload whose scene is not a scene', () => {
    const broken = { ...INITIAL_SNAPSHOT, scene: { id: 'NOPE' } };
    expect(snapshotSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a negative or fractional revision', () => {
    expect(snapshotSchema.safeParse(snapshot({ revision: -1 })).success).toBe(false);
    expect(snapshotSchema.safeParse(snapshot({ revision: 1.5 })).success).toBe(false);
  });
});

describe('supersedes', () => {
  it('accepts a newer revision', () => {
    expect(supersedes(snapshot({ revision: 4 }), snapshot({ revision: 3 }))).toBe(true);
  });

  it('drops one that lost a race', () => {
    // Out-of-order delivery would otherwise walk the beamer backwards into a
    // round that has already finished.
    expect(supersedes(snapshot({ revision: 2 }), snapshot({ revision: 3 }))).toBe(false);
  });

  it('accepts an equal revision, because that is what a catch-up answer is', () => {
    expect(supersedes(snapshot({ revision: 3 }), snapshot({ revision: 3 }))).toBe(true);
  });
});
