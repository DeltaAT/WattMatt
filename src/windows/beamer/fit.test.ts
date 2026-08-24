import { describe, expect, it } from 'vitest';

import { fitColumns, fitScale, gridColumns, STAGE_ASPECT } from '@/windows/beamer/fit';

/**
 * Fitting a scene onto the stage (issue #55).
 *
 * The two numbers checked here are the ones that decide whether a table, a team
 * or a match is on the wall at all, so they are checked at the sizes a real
 * evening reaches and well past them. The old scenes stopped at three
 * hand-tuned density steps and clipped everything above; the cases below are
 * mostly about what happens after the point where that used to give up.
 */

/** The three constants the scenes pass, kept here so the ladders are visible. */
const GROUPS = STAGE_ASPECT;
const SECTIONS = STAGE_ASPECT;
const TABLES = 9;

describe('fitColumns', () => {
  /*
   * The rungs the three scenes used to have as fixed steps. They are not
   * preserved out of nostalgia: they are the counts a club evening actually
   * has, and they were chosen by looking at a projector.
   */
  it('reproduces the group ladder the scene had before', () => {
    expect(fitColumns(16, GROUPS)).toBe(4);
    expect(fitColumns(36, GROUPS)).toBe(6);
    expect(fitColumns(64, GROUPS)).toBe(8);
  });

  it('reproduces the table ladder the scene had before', () => {
    expect(fitColumns(3, TABLES)).toBe(1);
    expect(fitColumns(5, TABLES)).toBe(1);
    expect(fitColumns(10, TABLES)).toBe(2);
    expect(fitColumns(16, TABLES)).toBe(2);
    expect(fitColumns(24, TABLES)).toBe(3);
  });

  it('reproduces the section ladder the round board had before', () => {
    expect(fitColumns(4, SECTIONS)).toBe(2);
    expect(fitColumns(9, SECTIONS)).toBe(3);
    expect(fitColumns(16, SECTIONS)).toBe(4);
  });

  /*
   * The point of the change. 64 was where every scene stopped; past it the
   * surplus fell off an `overflow-hidden` stage with nothing to say it had.
   */
  it('keeps taking columns past the point the old steps stopped at', () => {
    expect(fitColumns(100, GROUPS)).toBeGreaterThan(fitColumns(64, GROUPS));
    expect(fitColumns(256, GROUPS)).toBeGreaterThan(fitColumns(100, GROUPS));
    expect(fitColumns(64, TABLES)).toBeGreaterThan(fitColumns(24, TABLES));
  });

  it('never gives a grid more columns than it has things to put in them', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      expect(fitColumns(count, GROUPS)).toBeLessThanOrEqual(count);
    }
  });

  it('never gives fewer than one column', () => {
    for (const count of [0, 1, -3, Number.NaN]) {
      expect(fitColumns(count, GROUPS)).toBe(1);
    }
  });

  it('never goes down as the field grows', () => {
    let previous = 0;
    for (let count = 1; count <= 300; count += 1) {
      const columns = fitColumns(count, TABLES);
      expect(columns).toBeGreaterThanOrEqual(previous);
      previous = columns;
    }
  });

  /*
   * A wider cell wants a narrower grid: a table card is a label plus a whole
   * pairing, and three of them across a stage would truncate every one.
   */
  it('gives a wide cell fewer columns than a square one', () => {
    expect(fitColumns(36, TABLES)).toBeLessThan(fitColumns(36, GROUPS));
  });
});

describe('fitScale', () => {
  it('leaves a scene that already fits alone', () => {
    expect(fitScale(900, 600)).toBe(1);
    expect(fitScale(900, 900)).toBe(1);
  });

  /* Linear, because `zoom` multiplies every length inside: content twice as
   * tall as the box needs exactly half. */
  it('shrinks by exactly the ratio that is over', () => {
    expect(fitScale(900, 1800)).toBe(0.5);
    expect(fitScale(600, 800)).toBe(0.75);
  });

  /*
   * Nothing to measure: a container that has not been laid out, a hidden
   * window, jsdom. Guessing a shrink from a measurement that does not exist
   * would put the scene on the projector at some arbitrary size.
   */
  it('does not scale when there is nothing to measure', () => {
    expect(fitScale(0, 0)).toBe(1);
    expect(fitScale(900, 0)).toBe(1);
    expect(fitScale(0, 900)).toBe(1);
    expect(fitScale(Number.NaN, 900)).toBe(1);
    expect(fitScale(900, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('stays positive however far over the content is', () => {
    expect(fitScale(900, 90_000)).toBeGreaterThan(0);
  });
});

describe('gridColumns', () => {
  /*
   * `minmax(0, 1fr)` rather than `1fr`. A plain `1fr` track floors at `auto`,
   * so one long team name would widen its column and push the last one off the
   * stage — the exact failure this whole module exists to prevent.
   */
  it('builds tracks that cannot be widened by their content', () => {
    expect(gridColumns(4)).toEqual({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' });
  });

  it('never asks for fewer than one track', () => {
    expect(gridColumns(0)).toEqual({ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' });
  });
});
