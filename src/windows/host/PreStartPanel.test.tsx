// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { preStartReport } from '@/domain/start';
import { group, table, tournament } from '@/domain/testFixtures';
import type { ParticipantLabel, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { PreStartPanel } from '@/windows/host/PreStartPanel';

/**
 * The pre-start panel (issue #15).
 *
 * The checks themselves are tested in `@/domain/start`. What is checked here is
 * what the host actually reads: that a tournament that cannot start says so in
 * German on the button they were about to press, that an odd count announces the
 * `Freilos` *before* the draw, and that a table shortage is a sentence and not a
 * refusal.
 */

afterEach(cleanup);

function groups(n: number) {
  return Array.from({ length: n }, (_unused, index) => group(index + 1));
}

function tables(n: number) {
  return Array.from({ length: n }, (_unused, index) => table(index + 1));
}

function setup(
  document: Tournament = tournament({ groups: groups(2), tables: tables(1) }),
  participant: ParticipantLabel = 'GROUP',
) {
  const onStart = vi.fn();
  render(
    <PreStartPanel report={preStartReport(document)} participant={participant} onStart={onStart} />,
  );
  return onStart;
}

/**
 * Found by its data hook rather than by its accessible name: while a check is
 * failing the name *is* the reason, which is the point of the control.
 */
function startButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-prestart-action="start"]');
  if (button === null) {
    throw new Error('no start button rendered');
  }
  return button;
}

describe('a tournament that is ready', () => {
  it('says so and starts on one click', () => {
    const onStart = setup();

    expect(screen.getByText(de.start.ready)).not.toBeNull();
    expect(startButton().disabled).toBe(false);

    fireEvent.click(startButton());

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('a tournament that cannot start', () => {
  /*
   * The issue's first acceptance criterion. The reason is on the button itself
   * as well as in the list: a control that is greyed out with its explanation
   * somewhere else on the screen is one the host clicks again.
   */
  it('refuses one participant and states the reason in German', () => {
    setup(tournament({ groups: groups(1), tables: tables(1) }));

    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(de.participant.GROUP.tooFew)).not.toBeNull();
    expect(startButton().getAttribute('title')).toBe(
      de.start.blocked({ reason: de.participant.GROUP.tooFew }),
    );
  });

  it('states the reason in the wording this tournament uses', () => {
    setup(tournament({ groups: groups(1), tables: tables(1) }), 'TEAM');

    expect(screen.getByText(de.participant.TEAM.tooFew)).not.toBeNull();
    expect(screen.queryByText(de.participant.GROUP.tooFew)).toBeNull();
  });

  it('refuses a room with no usable table and says what to do about it', () => {
    setup(tournament({ groups: groups(4), tables: [table(1, { status: 'DISABLED' })] }));

    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(de.start.noUsableTable)).not.toBeNull();
  });

  it('lists every reason at once, rather than one at a time', () => {
    setup(tournament());

    expect(screen.getAllByText(/./, { selector: '[data-prestart-check="blocker"]' })).toHaveLength(
      2,
    );
  });
});

describe('the preview of round 1', () => {
  it('says how many matches the first round will have', () => {
    setup(tournament({ groups: groups(13), tables: tables(4) }));

    expect(screen.getByText(de.start.previewMatches({ n: 6 }))).not.toBeNull();
  });

  /*
   * The issue's second acceptance criterion: announced *before* the draw, so
   * the host can still ask one more person to play.
   */
  it('announces a Freilos at an odd count', () => {
    setup(tournament({ groups: groups(5), tables: tables(2) }));

    expect(screen.getByText(de.participant.GROUP.byePreview)).not.toBeNull();
  });

  it('says nothing about a Freilos at an even count', () => {
    setup(tournament({ groups: groups(6), tables: tables(3) }));

    expect(screen.queryByText(de.participant.GROUP.byePreview)).toBeNull();
  });

  it('announces the Freilos in the wording this tournament uses', () => {
    setup(tournament({ groups: groups(5), tables: tables(2) }), 'PLAYER');

    expect(screen.getByText(de.participant.PLAYER.byePreview)).not.toBeNull();
  });
});

describe('a table shortage', () => {
  /* A warning and never a block — how long a queue the host accepts is theirs
   * to decide (CLAUDE.md golden rule 3). */
  it('says how many matches will wait, and still lets the host start', () => {
    const onStart = setup(tournament({ groups: groups(40), tables: tables(3) }));

    expect(
      screen.getByText(de.start.tableShortage({ matches: 20, tables: 3, queued: 17 })),
    ).not.toBeNull();
    expect(startButton().disabled).toBe(false);

    fireEvent.click(startButton());

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for an ordinary evening', () => {
    setup(tournament({ groups: groups(8), tables: tables(2) }));

    expect(document.querySelector('[data-prestart-check="warning"]')).toBeNull();
  });
});

describe('a tournament that has already started', () => {
  /* The button is gone rather than disabled: the question no longer applies,
   * and a permanently dead control is one the host learns to ignore. */
  it('shows what happens next instead of the button', () => {
    setup(tournament({ groups: groups(4), tables: tables(2), phase: 'QUALIFYING' }));

    expect(screen.getByText(de.start.running)).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
