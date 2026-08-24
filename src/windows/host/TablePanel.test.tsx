// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TableId } from '@/domain/ids';
import { occupancyBoard, type MatchDisposition } from '@/domain/tables';
import {
  FIXED_NOW,
  group,
  match,
  matchId,
  midTournament,
  occupiedTable,
  table,
  tableId,
} from '@/domain/testFixtures';
import type { Timestamp } from '@/domain/types';
import { de } from '@/i18n';
import { TablePanel } from '@/windows/host/TablePanel';

/**
 * The host's table panel (issue #13).
 *
 * The rules are tested in `@/domain/tables`; what is checked here is what the
 * host actually experiences — that a free table goes away on one click, that a
 * busy one asks first, and that the running time on the board is the one the
 * clock says.
 */

afterEach(cleanup);

const RUNNING = midTournament();

function handlers() {
  return {
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDisable: vi.fn(),
    onEnable: vi.fn(),
    onRemove: vi.fn(),
    onShowOnBeamer: vi.fn(),
  };
}

function setup(now: Timestamp = FIXED_NOW, tournament = RUNNING) {
  const spies = handlers();
  render(
    <TablePanel
      board={occupancyBoard(
        tournament.tables,
        tournament.rounds.flatMap((r) => r.matches),
      )}
      groups={tournament.groups}
      now={now}
      {...spies}
    />,
  );
  return spies;
}

/** The row of the board that belongs to one table. */
function row(id: TableId): HTMLElement {
  const element = document.querySelector(`[data-table-id="${id}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no row for ${id}`);
  }
  return element;
}

const clickIn = (parent: HTMLElement, selector: string) => {
  const button = parent.querySelector(selector);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no button matching ${selector}`);
  }
  fireEvent.click(button);
};

const click = (parent: HTMLElement, action: string) =>
  clickIn(parent, `[data-table-action="${action}"]`);

const answer = (parent: HTMLElement, action: string) =>
  clickIn(parent, `[data-dialog-action="${action}"]`);

describe('the table panel', () => {
  it('shows every table with its status in words', () => {
    setup();

    expect(row(tableId(1))).toHaveProperty('dataset.tableStatus', 'OCCUPIED');
    expect(row(tableId(2)).textContent).toContain(de.table.free);
    expect(row(tableId(3)).textContent).toContain(de.table.disabled);
  });

  it('shows who is playing on a busy table and for how long', () => {
    setup('2026-08-23T10:12:31+02:00' as Timestamp);

    const busy = row(tableId(1)).textContent ?? '';
    expect(busy).toContain(`${de.group.numbered({ n: 1 })} ${de.match.versus} Die Schnellen`);
    expect(busy).toContain(de.table.runningFor({ duration: '12:31' }));
  });

  it('offers the quick-add of a whole room of tables at once', () => {
    const spies = setup();

    fireEvent.change(screen.getByLabelText(de.table.quickAddLabel), { target: { value: '8' } });
    fireEvent.click(screen.getByText(de.table.quickAdd));

    expect(spies.onAdd).toHaveBeenCalledWith(8);
  });

  /* A count that cannot be acted on must not look like one that can: the host
   * is typing under pressure and a button that does nothing is a bug report. */
  it.each(['', '0', '-2'])('will not add %p tables', (typed) => {
    setup();

    fireEvent.change(screen.getByLabelText(de.table.quickAddLabel), { target: { value: typed } });

    expect(screen.getByText(de.table.quickAdd)).toHaveProperty('disabled', true);
  });

  it('adds the one late table with a single click', () => {
    const spies = setup();

    fireEvent.click(screen.getByText(de.table.add));

    expect(spies.onAdd).toHaveBeenCalledWith(1);
  });

  it('renames a table when the host leaves the field', () => {
    const spies = setup();

    const field = row(tableId(2)).querySelector('input');
    fireEvent.change(field as HTMLInputElement, { target: { value: 'Fenstertisch' } });
    fireEvent.blur(field as HTMLInputElement);

    expect(spies.onRename).toHaveBeenCalledWith(tableId(2), 'Fenstertisch');
  });

  /* One rename per name, not one per keystroke: twelve steps on the undo stack
   * for one new label would bury the decision the host actually wants back. */
  it('does not rename on every keystroke', () => {
    const spies = setup();

    const field = row(tableId(2)).querySelector('input');
    fireEvent.change(field as HTMLInputElement, { target: { value: 'Fen' } });
    fireEvent.change(field as HTMLInputElement, { target: { value: 'Fenster' } });

    expect(spies.onRename).not.toHaveBeenCalled();
  });

  it('puts an emptied label back rather than asking for a nameless table', () => {
    const spies = setup();

    const field = row(tableId(2)).querySelector('input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);

    expect(spies.onRename).not.toHaveBeenCalled();
    expect(field.value).toBe('Table 2');
  });

  /*
   * `renameTable` refuses a name another table already answers to, and it
   * refuses by committing nothing — so the row never re-renders and the field
   * has to put the old name back itself. Leaving the refused one on screen
   * would show two identical rows and hand the next blur the same rejection.
   */
  it('puts a label another table already wears back', () => {
    const spies = setup();

    const field = row(tableId(2)).querySelector('input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Table 3' } });
    fireEvent.blur(field);

    // The panel asks — only the domain knows the rule — and shows the refusal.
    expect(spies.onRename).toHaveBeenCalledWith(tableId(2), 'Table 3');
    expect(field.value).toBe('Table 2');
  });

  it('moves a table up and down, and not off either end', () => {
    const spies = setup();

    click(row(tableId(2)), 'up');
    expect(spies.onMove).toHaveBeenCalledWith(tableId(2), -1);

    expect(row(tableId(1)).querySelector('[data-table-action="up"]')).toHaveProperty(
      'disabled',
      true,
    );
    expect(row(tableId(3)).querySelector('[data-table-action="down"]')).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('puts a table that is out of service back into service', () => {
    const spies = setup();

    click(row(tableId(3)), 'enable');

    expect(spies.onEnable).toHaveBeenCalledWith(tableId(3));
  });

  /* Nothing to ask: undo is the way back from a misclick, and a dialog in front
   * of every table change would cost the host two clicks each during setup. */
  it('takes a free table away without asking anything', () => {
    const spies = setup();

    click(row(tableId(2)), 'remove');

    expect(spies.onRemove).toHaveBeenCalledWith(tableId(2));
    expect(document.querySelector('[data-dialog="table-occupied"]')).toBeNull();
  });

  it('sends the beamer to the table overview', () => {
    const spies = setup();

    fireEvent.click(screen.getByText(de.table.showOnBeamer));

    expect(spies.onShowOnBeamer).toHaveBeenCalled();
  });

  it('says so when there is no table at all', () => {
    render(<TablePanel board={[]} groups={[]} now={FIXED_NOW} {...handlers()} />);

    expect(screen.getByText(de.table.empty)).toBeTruthy();
  });
});

/**
 * Issue #13: "deleting or disabling an occupied table asks what happens to the
 * running match". The table is going away, so the match has to go somewhere.
 */
describe('a table with a match on it', () => {
  const dialog = () => {
    const element = document.querySelector('[data-dialog="table-occupied"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('the dialog was not asked');
    }
    return element;
  };

  it('asks before it is deleted, naming the pair that is playing', () => {
    const spies = setup();

    click(row(tableId(1)), 'remove');

    expect(dialog().textContent).toContain(
      de.table.occupiedDialog.removeBody({ label: 'Table 1' }),
    );
    expect(dialog().querySelector('[data-dialog-pairing]')?.textContent).toContain(
      de.group.numbered({ n: 1 }),
    );
    expect(spies.onRemove).not.toHaveBeenCalled();
  });

  it('asks before it is taken out of service', () => {
    const spies = setup();

    click(row(tableId(1)), 'disable');

    expect(dialog().textContent).toContain(
      de.table.occupiedDialog.disableBody({ label: 'Table 1' }),
    );
    expect(spies.onDisable).not.toHaveBeenCalled();
  });

  it('sends the match back to the queue when the host says so', () => {
    const spies = setup();
    click(row(tableId(1)), 'remove');

    answer(dialog(), 'requeue');

    expect(spies.onRemove).toHaveBeenCalledWith(tableId(1), { kind: 'REQUEUE' });
    expect(document.querySelector('[data-dialog="table-occupied"]')).toBeNull();
  });

  it('moves the match to the free table the host picked', () => {
    const spies = setup();
    click(row(tableId(1)), 'disable');

    answer(dialog(), 'move');

    const expected: MatchDisposition = { kind: 'MOVE', toTableId: tableId(2) };
    expect(spies.onDisable).toHaveBeenCalledWith(tableId(1), expected);
  });

  /* The host has to know the match is queueing before they press the button,
   * not afterwards. */
  it('says out loud when there is no free table to move it to', () => {
    const noFreeTable = midTournament({
      tables: [occupiedTable(1, matchId(1)), table(2, { status: 'DISABLED' })],
    });
    setup(FIXED_NOW, noFreeTable);

    click(row(tableId(1)), 'remove');

    expect(dialog().textContent).toContain(de.table.occupiedDialog.noFreeTable);
    expect(dialog().querySelector('[data-dialog-action="move"]')).toHaveProperty('disabled', true);
  });

  it('leaves everything alone when the host thinks better of it', () => {
    const spies = setup();
    click(row(tableId(1)), 'remove');

    answer(dialog(), 'cancel');

    expect(spies.onRemove).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dialog="table-occupied"]')).toBeNull();
  });

  it('reports a match it cannot find rather than an empty question', () => {
    const broken = midTournament({
      tables: [occupiedTable(1, matchId(99)), table(2)],
      groups: [group(1)],
      rounds: [],
    });
    setup(FIXED_NOW, broken);

    click(row(tableId(1)), 'disable');

    expect(dialog().querySelector('[data-dialog-pairing]')?.textContent).toBe(
      de.table.unknownMatch,
    );
  });
});

/** Kept out of the suite above: it only exists to keep the fixture honest. */
describe('the fixture the panel is tested against', () => {
  it('is a tournament with a match actually running on a table', () => {
    expect(RUNNING.tables[0]?.currentMatchId).toBe(matchId(1));
    expect(RUNNING.rounds.flatMap((r) => r.matches).map((entry) => entry.id)).toContain(
      match(1).id,
    );
  });
});
