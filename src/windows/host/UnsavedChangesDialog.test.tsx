import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import { UnsavedChangesDialog } from '@/windows/host/UnsavedChangesDialog';

function render(): string {
  return renderToStaticMarkup(<UnsavedChangesDialog onAnswer={() => {}} />);
}

describe('UnsavedChangesDialog', () => {
  /**
   * All three answers, always. A dialog that only offers "speichern" and
   * "abbrechen" traps a host who deliberately wants to throw a misclick away,
   * and one without "abbrechen" punishes hitting the close button by accident.
   */
  it('offers saving, discarding and backing out', () => {
    const markup = render();

    expect(markup).toContain(de.file.unsaved.saveAndClose);
    expect(markup).toContain(de.file.unsaved.discard);
    expect(markup).toContain(de.common.cancel);
  });

  it('says what is at stake and what to do about it', () => {
    const markup = render();

    expect(markup).toContain(de.file.unsaved.title);
    expect(markup).toContain(de.file.unsaved.body);
  });

  it('is a modal dialog rather than a panel that can be ignored', () => {
    const markup = render();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
  });
});
