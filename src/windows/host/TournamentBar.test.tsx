import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import type { FileState } from '@/store/tournamentStore';
import { TournamentBar } from '@/windows/host/TournamentBar';

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

function render(file: FileState, name = 'Sommerturnier'): string {
  return renderToStaticMarkup(
    <TournamentBar
      name={name}
      file={file}
      busy={false}
      onSave={() => {}}
      onSaveAs={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('TournamentBar', () => {
  it('names the open tournament', () => {
    expect(render({ status: 'saved', path: PATH })).toContain('Sommerturnier');
  });

  it('offers save, save-as and close', () => {
    const markup = render({ status: 'saved', path: PATH });

    expect(markup).toContain(de.file.save);
    expect(markup).toContain(de.file.saveAs);
    expect(markup).toContain(de.file.close);
  });

  it('says in words whether the tournament is on disk', () => {
    expect(render({ status: 'saved', path: PATH })).toContain(de.file.stateSaved);
    expect(render({ status: 'modified', path: PATH })).toContain(de.file.stateModified);
    expect(render({ status: 'unsaved' })).toContain(de.file.stateUnwritten);
  });

  /**
   * A tournament that has never been written is the one state worth
   * interrupting for: nothing would survive a crash, which is the failure the
   * whole file layer exists to prevent.
   */
  it('raises an alert only for a tournament that has never been written', () => {
    expect(render({ status: 'unsaved' })).toContain('role="alert"');
    expect(render({ status: 'modified', path: PATH })).not.toContain('role="alert"');
    expect(render({ status: 'saved', path: PATH })).not.toContain('role="alert"');
  });

  it('shows the path it is saving to, without spending a line on it', () => {
    expect(render({ status: 'saved', path: PATH })).toContain(PATH);
  });
});
