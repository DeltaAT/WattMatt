import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de, formatTime } from '@/i18n';
import { IDLE_AUTOSAVE, type AutosaveState } from '@/store/autosave';
import type { FileState } from '@/store/tournamentStore';
import { TournamentBar } from '@/windows/host/TournamentBar';

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

function render(
  file: FileState,
  autosave: AutosaveState = IDLE_AUTOSAVE,
  name = 'Sommerturnier',
): string {
  return renderToStaticMarkup(
    <TournamentBar
      name={name}
      file={file}
      autosave={autosave}
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

  /**
   * Issue #10's "discreet save indicator (\"Gespeichert 19:31\") — never a
   * modal". The time is the whole point: "Gespeichert" on its own cannot tell a
   * host whether the autosave stopped working ten minutes ago.
   */
  it('names the time of the last autosave', () => {
    const at = new Date(2026, 7, 22, 19, 31);
    const markup = render(
      { status: 'saved', path: PATH },
      {
        activity: 'idle',
        lastSavedAt: at.getTime(),
        failure: null,
      },
    );

    // Compared against the formatter rather than a literal: the host's machine
    // decides the time zone, and a hardcoded "19:31" would only pass in ours.
    expect(markup).toContain(de.file.stateSavedAt({ time: formatTime(at) }));
  });

  it('says a write is in flight while one is, whatever the file state says', () => {
    const markup = render(
      { status: 'modified', path: PATH },
      {
        activity: 'saving',
        lastSavedAt: 1,
        failure: null,
      },
    );

    expect(markup).toContain(de.file.stateSaving);
    expect(markup).not.toContain(de.file.stateModified);
  });

  /**
   * A tournament with no file at all outranks a stale timestamp: that is the
   * one case where nothing is being written and nobody is coming to fix it.
   */
  it('keeps warning about a tournament with no file even after an earlier save', () => {
    const markup = render(
      { status: 'unsaved' },
      {
        activity: 'idle',
        lastSavedAt: 1_700_000_000_000,
        failure: null,
      },
    );

    expect(markup).toContain(de.file.stateUnwritten);
    expect(markup).toContain('role="alert"');
  });

  it('says only "Gespeichert" before the first autosave of a freshly opened file', () => {
    expect(render({ status: 'saved', path: PATH })).toContain(`>${de.file.stateSaved}<`);
  });
});
