import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  isBeamerAlive,
  startHeartbeat,
  watchHeartbeat,
} from '@/store/heartbeat';
import { createLinkedTransports } from '@/store/testTransport';

describe('isBeamerAlive', () => {
  it('is false before the first beat has ever arrived', () => {
    // "Not heard from yet" must not read as alive, or the host trusts a
    // projector that never came up.
    expect(isBeamerAlive(null, 10_000)).toBe(false);
  });

  it('holds through a beat that is merely late', () => {
    const lastBeat = 10_000;
    expect(isBeamerAlive(lastBeat, lastBeat + HEARTBEAT_INTERVAL_MS * 2)).toBe(true);
  });

  it('gives up exactly at the timeout, not after it', () => {
    const lastBeat = 10_000;
    expect(isBeamerAlive(lastBeat, lastBeat + HEARTBEAT_TIMEOUT_MS - 1)).toBe(true);
    expect(isBeamerAlive(lastBeat, lastBeat + HEARTBEAT_TIMEOUT_MS)).toBe(false);
  });
});

describe('the heartbeat channel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('beats immediately, so a beamer that just came back is not reported dead', async () => {
    const transports = createLinkedTransports();
    const beats: number[] = [];
    const clock = 1_000;
    await watchHeartbeat(
      transports.host,
      () => clock,
      (at) => beats.push(at),
    );

    const stop = startHeartbeat(transports.beamer);

    expect(beats).toEqual([1_000]);
    stop();
  });

  it('keeps beating on the interval and stops when the window goes away', async () => {
    const transports = createLinkedTransports();
    const beats: number[] = [];
    let clock = 0;
    await watchHeartbeat(
      transports.host,
      () => clock,
      (at) => beats.push(at),
    );

    const stop = startHeartbeat(transports.beamer);
    clock = HEARTBEAT_INTERVAL_MS;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    clock = HEARTBEAT_INTERVAL_MS * 2;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(beats).toEqual([0, HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS * 2]);

    stop();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);

    // A dead window stops beating; that silence is what the host reads.
    expect(beats).toHaveLength(3);
    expect(isBeamerAlive(beats.at(-1) ?? null, HEARTBEAT_INTERVAL_MS * 7)).toBe(false);
  });
});
