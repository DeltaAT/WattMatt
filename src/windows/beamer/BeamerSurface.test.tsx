import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import type { BeamerPlacement } from '@/platform/beamerWindow';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';

/**
 * The beamer's presentation properties are the ones fifty people see at once,
 * and every one of them is a class on a div that a future refactor could drop
 * without any test noticing. So they are asserted here rather than trusted.
 *
 * Static rendering is enough: nothing below depends on an effect, and the
 * context-menu listeners the surface installs are the only part that does.
 */
function render(placement: BeamerPlacement, performanceMode = false): string {
  return renderToStaticMarkup(
    <BeamerSurface placement={placement} performanceMode={performanceMode}>
      <p>scene</p>
    </BeamerSurface>,
  );
}

const projected = render('projected');
const preview = render('preview');

describe('the beamer surface', () => {
  /*
   * docs/MOTION.md §6: the cheap motion is a host toggle that has to reach a
   * window already showing something, so it rides in on the snapshot and lands
   * on the root as an attribute the stylesheet keys on (issue #15).
   */
  it('carries the performance mode the host set', () => {
    expect(render('projected', true)).toContain('data-performance-mode="true"');
    expect(projected).toContain('data-performance-mode="false"');
  });

  it('renders the scene it is given', () => {
    expect(projected).toContain('<p>scene</p>');
  });

  it('draws every scene into a 16:9 stage', () => {
    // Letterbox rather than reflow on a projector that is not 16:9 —
    // docs/STYLEGUIDE.md §3.
    expect(projected).toContain('beamer-stage');
  });

  it('carries the resolution-relative type scale', () => {
    expect(projected).toContain('beamer-root');
  });

  it('allows no selection and no scrollbar', () => {
    for (const markup of [projected, preview]) {
      expect(markup).toContain('select-none');
      expect(markup).toContain('overflow-hidden');
    }
  });

  it('hides the cursor when projected', () => {
    // `.beamer-root` sets `cursor: none`; the projected surface must not
    // override it (docs/STYLEGUIDE.md §5).
    expect(projected).not.toContain('cursor-auto');
  });

  /*
   * With one screen the preview shares the monitor with the host UI. Hiding the
   * host's only pointer whenever it crosses that window would be a trap.
   */
  it('gives the cursor back in the windowed preview', () => {
    expect(preview).toContain('cursor-auto');
  });

  it('marks the preview as a preview, in German, from the locale file', () => {
    expect(preview).toContain(de.beamer.previewBadge);
    expect(projected).not.toContain(de.beamer.previewBadge);
  });

  it('reports its placement to the DOM for styling and debugging', () => {
    expect(projected).toContain('data-placement="projected"');
    expect(preview).toContain('data-placement="preview"');
  });
});
