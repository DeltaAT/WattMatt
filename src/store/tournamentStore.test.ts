import { describe, expect, it } from 'vitest';

import { createTournamentStore, toSnapshot } from '@/store/tournamentStore';

describe('the host store handle', () => {
  it('offers no way to write state except through a commit', () => {
    const store = createTournamentStore();

    // The whole "one central broadcast" design rests on this. A reachable
    // setState lets a component change state that never bumps the revision,
    // and the broadcast skips it without a sound.
    expect(Object.keys(store).sort()).toEqual(['commit', 'getState', 'onCommit', 'subscribe']);
    expect('setState' in store).toBe(false);
  });

  it('bumps the revision on every commit, including one that changes nothing', () => {
    const store = createTournamentStore();

    store.commit(() => ({}));
    store.commit(() => ({ autoFollow: false }));

    expect(store.getState().revision).toBe(2);
    expect(store.getState().autoFollow).toBe(false);
  });

  it('reports whether a commit touched the tournament', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.touchedTournament));

    store.commit(() => ({ autoFollow: false }));
    store.commit(() => ({ tournament: { groups: [] } }));

    expect(seen).toEqual([false, true]);
  });

  it('reports a tournament touched in place, which a state comparison would miss', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.touchedTournament));

    // Actions are supposed to be immutable, but an in-place edit that still
    // returns the field must not be mistaken for "nothing changed" — that would
    // send it down the light channel and drop the data silently.
    store.commit((state) => {
      const tournament = state.tournament;
      return { tournament };
    });

    expect(seen).toEqual([true]);
  });

  /**
   * docs/FILE-FORMAT.md rule 4: round close and phase change are written at
   * once rather than after the debounce. Whether a commit is one of those is
   * something only the action knows, so it is passed rather than inferred —
   * and it has to reach the autosave through the same funnel everything else
   * uses (issue #10).
   */
  it('passes an urgent commit on as urgent, and an ordinary one as not', () => {
    const store = createTournamentStore();
    const seen: boolean[] = [];
    store.onCommit((_state, meta) => seen.push(meta.urgent));

    store.commit(() => ({ autoFollow: false }));
    store.commit(() => ({ autoFollow: true }), { urgent: true });
    store.commit(() => ({ autoFollow: false }), {});

    expect(seen).toEqual([false, true, false]);
  });

  it('stops notifying a listener that unsubscribed', () => {
    const store = createTournamentStore();
    let count = 0;
    const off = store.onCommit(() => (count += 1));

    store.commit(() => ({}));
    off();
    store.commit(() => ({}));

    expect(count).toBe(1);
  });
});

describe('toSnapshot', () => {
  it('describes the store as it is, defaulting to a live delivery', () => {
    const store = createTournamentStore();
    store.commit(() => ({ scene: { id: 'BRACKET' } }));

    expect(toSnapshot(store.getState())).toEqual({
      revision: 1,
      scene: { id: 'BRACKET' },
      autoFollow: true,
      tournament: { groups: [] },
      delivery: 'live',
    });
    expect(toSnapshot(store.getState(), 'catchUp').delivery).toBe('catchUp');
  });
});
