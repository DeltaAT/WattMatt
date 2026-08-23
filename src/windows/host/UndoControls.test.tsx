import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import { UndoControls } from '@/windows/host/UndoControls';

/**
 * What the host reads before pressing undo (issue #11).
 *
 * The buttons carry the label of the step they would take: a host who has just
 * misclicked in front of the room has to see what is about to disappear, and
 * after two presses, what is left.
 */

const LABEL = 'Sieger festgelegt: Gruppe 7';

function render(undoLabel: string | null, redoLabel: string | null): string {
  return renderToStaticMarkup(
    <UndoControls undoLabel={undoLabel} redoLabel={redoLabel} undo={() => {}} redo={() => {}} />,
  );
}

describe('the undo controls', () => {
  it('names the step the undo button would take', () => {
    const markup = render(LABEL, null);

    expect(markup).toContain(de.undo.undoStep({ label: LABEL }));
  });

  it('names the step the redo button would put back', () => {
    const markup = render(null, LABEL);

    expect(markup).toContain(de.undo.redoStep({ label: LABEL }));
  });

  it('disables each button on its own', () => {
    const undoOnly = render(LABEL, null);
    const redoOnly = render(null, LABEL);

    // One disabled button in each, and it is the one with nothing to do.
    expect(undoOnly.match(/disabled=""/g)).toHaveLength(1);
    expect(redoOnly.match(/disabled=""/g)).toHaveLength(1);
    expect(undoOnly).toMatch(/data-undo="redo"[^>]*disabled=""|disabled=""[^>]*data-undo="redo"/);
    expect(redoOnly).toMatch(/data-undo="undo"[^>]*disabled=""|disabled=""[^>]*data-undo="undo"/);
    expect(undoOnly).toContain(de.undo.redo);
    expect(redoOnly).toContain(de.undo.undo);
  });

  /**
   * Issue #11: a step that cannot be taken is "blocked with a clear German
   * explanation". A greyed-out button is not an explanation — the host is left
   * to work out for themselves that the history starts at the tournament they
   * opened (docs/OPEN-QUESTIONS.md #20).
   */
  it('says why, when there is nothing to take back', () => {
    const markup = render(null, null);

    expect(markup).toContain(de.undo.nothingToUndo);
    expect(markup).toContain(de.undo.nothingToRedo);
  });

  it('keeps the explanation out of the way once there is a step', () => {
    const markup = render(LABEL, null);

    expect(markup).not.toContain(de.undo.nothingToUndo);
  });
});
