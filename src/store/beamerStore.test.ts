import { describe, expect, it } from 'vitest';

import { roundIdSchema } from '@/domain/ids';
import { INITIAL_SNAPSHOT, type Snapshot } from '@/domain/snapshot';
import { createBeamerStore } from '@/store/beamerStore';

const round = (value: string) => roundIdSchema.parse(value);

function snapshot(overrides: Partial<Snapshot>): Snapshot {
  return { ...INITIAL_SNAPSHOT, ...overrides };
}

describe('the beamer store', () => {
  it('throws in dev when a component tries to write to it', () => {
    const store = createBeamerStore(undefined, { freeze: true });
    store.applySnapshot(snapshot({ revision: 1, tournament: { groups: [] }, delivery: 'live' }));

    const state = store.getState();

    // Modules are ESM and therefore strict mode, so a frozen write throws
    // rather than failing silently — at the line that made the mistake.
    expect(() => {
      (state as { animate: boolean }).animate = true;
    }).toThrow(TypeError);
  });

  it('freezes nested tournament data, not just the top level', () => {
    const store = createBeamerStore(undefined, { freeze: true });
    store.applySnapshot(snapshot({ revision: 1, delivery: 'live' }));

    // The realistic mistake is a scene component sorting or pushing into the
    // list it was handed, not reassigning the state object.
    expect(() => {
      store.getState().snapshot.tournament.groups.push({
        id: 'g1' as never,
        number: 1,
        name: null,
        status: 'ACTIVE',
      });
    }).toThrow(TypeError);
  });

  it('exposes no way to set state other than applying a snapshot', () => {
    const store = createBeamerStore();

    expect(Object.keys(store).sort()).toEqual(['applySnapshot', 'getState', 'subscribe']);
    expect('setState' in store).toBe(false);
  });

  it('renders a catch-up settled and a live change animated', () => {
    const store = createBeamerStore(undefined, { freeze: false });

    store.applySnapshot(
      snapshot({ revision: 5, scene: { id: 'DRAW', roundId: round('r1') }, delivery: 'catchUp' }),
    );
    expect(store.getState().animate).toBe(false);

    store.applySnapshot(snapshot({ revision: 6, scene: { id: 'BRACKET' }, delivery: 'live' }));
    expect(store.getState().animate).toBe(true);
  });

  it('ignores a snapshot older than the one it holds', () => {
    const store = createBeamerStore(undefined, { freeze: false });

    store.applySnapshot(snapshot({ revision: 5, scene: { id: 'BRACKET' }, delivery: 'live' }));
    store.applySnapshot(snapshot({ revision: 4, scene: { id: 'IDLE' }, delivery: 'live' }));

    expect(store.getState().snapshot.scene).toEqual({ id: 'BRACKET' });
  });

  it('notifies subscribers so React re-renders', () => {
    const store = createBeamerStore(undefined, { freeze: false });
    const seen: number[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.snapshot.revision));

    store.applySnapshot(snapshot({ revision: 1, delivery: 'live' }));
    store.applySnapshot(snapshot({ revision: 2, delivery: 'live' }));
    unsubscribe();
    store.applySnapshot(snapshot({ revision: 3, delivery: 'live' }));

    expect(seen).toEqual([1, 2]);
  });
});
