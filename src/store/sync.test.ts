import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupIdSchema, roundIdSchema } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { midTournament } from '@/domain/testFixtures';
import { setOpenedDocument } from '@/store/actions/document';
import { blackout, showScene } from '@/store/actions/scene';
import { createBeamerStore } from '@/store/beamerStore';
import { startBeamerSync, startHostSync } from '@/store/sync';
import { requestSnapshotSchema } from '@/store/syncContract';
import { createLinkedTransports } from '@/store/testTransport';
import { createTournamentStore } from '@/store/tournamentStore';

const round = (value: string) => roundIdSchema.parse(value);

function groups(count: number): TournamentSnapshot {
  return {
    groups: Array.from({ length: count }, (_, index) => ({
      id: groupIdSchema.parse(`g${index + 1}`),
      number: index + 1,
      name: `Gruppe ${index + 1}`,
      status: 'ACTIVE' as const,
    })),
    participantLabel: 'GROUP',
    performanceMode: false,
    tables: [],
    matches: [],
    round: null,
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

    host.commit(() => ({ tournament: groups(3) }));

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
    host.commit(() => ({ tournament: groups(2) }));

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
    host.commit(() => ({ tournament: groups(24) }));
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

    host.commit(() => ({ tournament: groups(8) }));
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

    host.commit(() => ({ tournament: groups(40) }));

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

describe('a beamer that starts before the host is listening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks again until it gets an answer', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    host.commit(() => ({ scene: { id: 'CEREMONY' } }));

    // Rust opens the beamer during setup, so it can come up first and ask
    // before anyone is there to hear it.
    const beamer = createBeamerStore();
    await startBeamerSync(beamer, transports.beamer);
    expect(beamer.getState().snapshot.scene).toEqual({ id: 'IDLE' });

    await startHostSync(host, transports.host);
    await vi.advanceTimersByTimeAsync(300);

    // Without the retry this beamer shows the idle screen until the host
    // happens to commit something, which at the start of an event is minutes.
    expect(beamer.getState().snapshot.scene).toEqual({ id: 'CEREMONY' });
  });

  it('stops asking once answered, rather than retrying forever', async () => {
    const transports = createLinkedTransports();
    const host = createTournamentStore();
    await startHostSync(host, transports.host);

    let requests = 0;
    await transports.host.listen('state:request-snapshot', requestSnapshotSchema, () => {
      requests += 1;
    });

    const beamer = createBeamerStore();
    await startBeamerSync(beamer, transports.beamer);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(requests).toBe(1);
  });
});

describe('a re-delivered snapshot', () => {
  it('does not settle a scene that is still animating', async () => {
    const { host, beamer, transports } = await wiredPair();

    showScene(host, { id: 'DRAW', roundId: round('r1') });
    expect(beamer.getState().animate).toBe(true);

    // React StrictMode mounts the beamer twice, so the host answers a second
    // catch-up at the same revision while the draw is still animating.
    await transports.host.emit('state:snapshot', {
      ...beamer.getState().snapshot,
      delivery: 'catchUp',
    });

    expect(beamer.getState().animate).toBe(true);
  });
});

/**
 * Issue #11: "the beamer follows an undo like any other state change, without
 * replaying reveal animations". Both halves matter — a beamer that ignored the
 * undo would show the audience a result the host has withdrawn, and one that
 * animated into it would play the reveal a second time.
 */
describe('an undo on the projector', () => {
  it('moves the picture without animating into it', async () => {
    const { host, beamer } = await wiredPair();
    setOpenedDocument(host, midTournament(), 'C:\\Turniere\\Sommer.wattmatt');

    showScene(host, { id: 'DRAW', roundId: round('r1') });
    expect(beamer.getState().animate).toBe(true);

    host.undo();

    expect(beamer.getState().snapshot.scene).toEqual({ id: 'IDLE' });
    expect(beamer.getState().snapshot.revision).toBe(host.getState().revision);
    expect(beamer.getState().animate).toBe(false);
  });

  it('carries the tournament back too, not only the scene', async () => {
    const { host, beamer } = await wiredPair();
    setOpenedDocument(host, midTournament(), 'C:\\Turniere\\Sommer.wattmatt');
    const before = beamer.getState().snapshot.tournament.groups.length;

    host.commit(
      (state) => ({
        document: {
          ...state.document!,
          groups: state.document!.groups.slice(0, 2),
        },
      }),
      { undoLabel: 'Groups reduced', log: { action: 'GROUPS_CHANGED', payload: {} } },
    );
    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(2);

    host.undo();

    expect(beamer.getState().snapshot.tournament.groups).toHaveLength(before);
    expect(beamer.getState().animate).toBe(false);
  });

  it('takes a blackout back on the cheap channel, settled', async () => {
    const { host, beamer, transports } = await wiredPair();
    setOpenedDocument(host, midTournament(), 'C:\\Turniere\\Sommer.wattmatt');

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

    blackout(host);
    host.undo();

    // A blackout goes out light and has to come back light. An undo that
    // rewrote the tournament would put the host's correction of the projector
    // behind the whole payload — and dirty the file for it.
    expect(seen).toEqual(['scene', 'scene']);
    expect(beamer.getState().snapshot.scene).toEqual({ id: 'IDLE' });
    expect(beamer.getState().snapshot.delivery).toBe('catchUp');
    expect(beamer.getState().animate).toBe(false);
  });

  it('is still the picture a beamer reopened afterwards is handed', async () => {
    const { host, transports, beamerSync } = await wiredPair();
    setOpenedDocument(host, midTournament(), 'C:\\Turniere\\Sommer.wattmatt');

    showScene(host, { id: 'DRAW', roundId: round('r1') });
    host.undo();

    // The projector cable is pulled and plugged back in mid-event.
    await beamerSync.stop();
    const reopened = createBeamerStore();
    await startBeamerSync(reopened, transports.beamer);

    expect(reopened.getState().snapshot.scene).toEqual({ id: 'IDLE' });
    expect(reopened.getState().snapshot.revision).toBe(host.getState().revision);
    expect(reopened.getState().animate).toBe(false);
  });
});
