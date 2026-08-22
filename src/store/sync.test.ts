import { describe, expect, it } from 'vitest';

import { groupIdSchema, roundIdSchema } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { showScene } from '@/store/actions/scene';
import { createBeamerStore } from '@/store/beamerStore';
import { startBeamerSync, startHostSync } from '@/store/sync';
import { createLinkedTransports } from '@/store/testTransport';
import { commit, createTournamentStore } from '@/store/tournamentStore';

const round = (value: string) => roundIdSchema.parse(value);

function groups(count: number): TournamentSnapshot {
  return {
    groups: Array.from({ length: count }, (_, index) => ({
      id: groupIdSchema.parse(`g${index + 1}`),
      number: index + 1,
      name: `Gruppe ${index + 1}`,
    })),
  };
}

async function wiredPair() {
  const transports = createLinkedTransports();
  const host = createTournamentStore();
  const beamer = createBeamerStore();

  const hostSync = await startHostSync(host, transports.host);
  const beamerSync = await startBeamerSync(beamer, transports.beamer);

  return { transports, host, beamer, hostSync, beamerSync };
}

describe('the host to beamer channel', () => {
  it('broadcasts every committed action without the action doing anything', async () => {
    const { host, beamer } = await wiredPair();

    // showScene only commits. Nothing in it mentions the beamer.
    showScene(host, { id: 'BRACKET' });

    expect(beamer.getState().snapshot.scene).toEqual({ id: 'BRACKET' });
    expect(beamer.getState().snapshot.revision).toBe(host.getState().revision);
  });

  it('carries tournament data, not just scenes', async () => {
    const { host, beamer } = await wiredPair();

    commit(host, () => ({ tournament: groups(3) }));

    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(3);
    expect(beamer.getState().snapshot.tournament.groups[1]?.name).toBe('Gruppe 2');
  });

  it('animates into a scene the host switches to live', async () => {
    const { host, beamer } = await wiredPair();

    showScene(host, { id: 'DRAW', roundId: round('r1') });

    expect(beamer.getState().animate).toBe(true);
  });

  it('does not re-animate a scene it is already showing', async () => {
    const { host, beamer } = await wiredPair();

    showScene(host, { id: 'DRAW', roundId: round('r1') });
    commit(host, () => ({ tournament: groups(2) }));

    // The scene did not change, so the second snapshot must not restart the
    // draw animation in front of the room.
    expect(beamer.getState().animate).toBe(false);
    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(2);
  });
});

describe('a beamer that is killed and reopened', () => {
  it('reproduces the exact current scene in its settled state', async () => {
    const { host, transports, beamerSync } = await wiredPair();

    // Mid-tournament: groups drawn, the draw scene is on the projector.
    commit(host, () => ({ tournament: groups(24) }));
    showScene(host, { id: 'DRAW', roundId: round('r3') });

    // The projector is unplugged and the window dies.
    await beamerSync.stop();

    // A brand new window with no memory of anything.
    const reopened = createBeamerStore();
    await startBeamerSync(reopened, transports.beamer);

    const restored = reopened.getState();
    expect(restored.snapshot.scene).toEqual({ id: 'DRAW', roundId: round('r3') });
    expect(restored.snapshot.tournament.groups).toHaveLength(24);
    expect(restored.snapshot.revision).toBe(host.getState().revision);

    // The headline criterion: settled, not replayed. Re-running the draw
    // animation would show the audience a draw that already happened.
    expect(restored.snapshot.delivery).toBe('catchUp');
    expect(restored.animate).toBe(false);
  });

  it('catches up even when it was never running for any of the commits', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    await startHostSync(host, transports.host);

    commit(host, () => ({ tournament: groups(8) }));
    showScene(host, { id: 'CEREMONY' });

    const beamer = createBeamerStore();
    await startBeamerSync(beamer, transports.beamer);

    expect(beamer.getState().snapshot.scene).toEqual({ id: 'CEREMONY' });
    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(8);
  });
});

describe('message ordering', () => {
  it('drops a snapshot that lost a race', async () => {
    const { host, beamer, transports } = await wiredPair();

    showScene(host, { id: 'BRACKET' });
    const current = beamer.getState().snapshot;

    // A stale snapshot from before the switch arrives late.
    await transports.host.emit('state:snapshot', {
      ...current,
      revision: current.revision - 1,
      scene: { id: 'GROUP_OVERVIEW' },
    });

    expect(beamer.getState().snapshot.scene).toEqual({ id: 'BRACKET' });
  });
});

describe('the scene channel', () => {
  it('sends a scene-only change without a full snapshot, and still lands', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    const beamer = createBeamerStore();
    await startHostSync(host, transports.host);
    await startBeamerSync(beamer, transports.beamer);

    commit(host, () => ({ tournament: groups(40) }));

    const seen: string[] = [];
    await transports.beamer.listen(
      'state:snapshot',
      (await import('@/domain/snapshot')).snapshotSchema,
      () => seen.push('snapshot'),
    );
    await transports.beamer.listen(
      'beamer:scene',
      (await import('@/store/syncContract')).sceneMessageSchema,
      () => seen.push('scene'),
    );

    showScene(host, { id: 'BLACKOUT' });

    // The blackout went out on the cheap channel, not behind 40 groups.
    expect(seen).toEqual(['scene']);
    expect(beamer.getState().snapshot.scene).toEqual({ id: 'BLACKOUT' });
    // ...and the tournament data it already had is still there.
    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(40);
  });
});

describe('the contract itself', () => {
  it('gives the beamer no event with which to change the tournament', async () => {
    const contract = await import('@/store/syncContract');
    const beamerToHost = [contract.REQUEST_SNAPSHOT_EVENT, contract.HEARTBEAT_EVENT];

    // Golden rule 4 holds because no such message exists, not because the
    // beamer chooses not to send one.
    expect(beamerToHost).toEqual(['state:request-snapshot', 'beamer:heartbeat']);
  });
});
