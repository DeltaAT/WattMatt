import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import type { BackupEntry } from '@/platform/tournamentFile';
import { FileNotice } from '@/windows/host/FileNotice';
import type { FileNotice as Notice } from '@/windows/host/useTournamentDocument';

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

const BACKUP: BackupEntry = {
  path: `${PATH}.bak1`,
  suffix: 'bak1',
  modifiedAt: 1,
  bytes: 512,
};

function render(notice: Notice): string {
  return renderToStaticMarkup(
    <FileNotice
      notice={notice}
      busy={false}
      onOpenBackup={() => {}}
      onSaveAs={() => {}}
      onDismiss={() => {}}
    />,
  );
}

describe('FileNotice', () => {
  /**
   * Issue #9 acceptance criterion: a hand-corrupted file produces a clear
   * German message, never a white screen — and the backup is offered with it
   * (docs/FILE-FORMAT.md rule 1).
   */
  it('offers the backup beside the message for a file that would not parse', () => {
    const markup = render({
      kind: 'openFailed',
      reason: 'invalid',
      path: PATH,
      backups: [BACKUP],
    });

    expect(markup).toContain(de.error.fileInvalid);
    expect(markup).toContain(de.file.openBackup);
  });

  it('separates a file it could not read from one it could not parse', () => {
    const markup = render({
      kind: 'openFailed',
      reason: 'unreadable',
      path: PATH,
      backups: [],
    });

    expect(markup).toContain(de.error.fileUnreadable);
  });

  it('says plainly when there is no backup to fall back to', () => {
    const markup = render({ kind: 'openFailed', reason: 'invalid', path: PATH, backups: [] });

    expect(markup).toContain(de.file.noBackup);
    expect(markup).not.toContain(de.file.openBackup);
  });

  /**
   * The variant Rust returned decides the sentence. The OS message behind it is
   * in whatever language Windows was installed in, and is for the log only.
   */
  it('names the actual problem when a save fails', () => {
    expect(render({ kind: 'saveFailed', errorKind: 'permissionDenied' })).toContain(
      de.error.fileLocked,
    );
    expect(render({ kind: 'saveFailed', errorKind: 'notFound' })).toContain(de.error.fileMissing);
    expect(render({ kind: 'saveFailed', errorKind: 'io' })).toContain(de.error.saveFailed);
  });

  it('tells the host where to put a tournament that never reached disk', () => {
    expect(render({ kind: 'notWritten', errorKind: 'permissionDenied' })).toContain(
      de.error.fileNotWritten,
    );
  });

  /**
   * The notice is about something that already failed. Offering "Abbrechen"
   * asks the host to call off an action that is over — the wrong word, and the
   * kind of wrong that only shows up in front of an audience.
   */
  it('dismisses rather than cancels', () => {
    const markup = render({ kind: 'saveFailed', errorKind: 'io' });

    expect(markup).toContain(de.common.dismiss);
    expect(markup).not.toContain(de.common.cancel);
  });

  it('is an alert, so it is announced rather than merely drawn', () => {
    expect(render({ kind: 'saveFailed', errorKind: 'io' })).toContain('role="alert"');
  });

  /**
   * Issue #10's edge case: "disk full / file locked → warn loudly and offer
   * Speichern unter…". A message with no way out is a message the host can only
   * read.
   */
  it('offers "Speichern unter…" for everything that could not be written', () => {
    expect(render({ kind: 'saveFailed', errorKind: 'io' })).toContain(de.file.saveAs);
    expect(render({ kind: 'notWritten', errorKind: 'permissionDenied' })).toContain(de.file.saveAs);
    expect(render({ kind: 'autosaveFailed', errorKind: 'io' })).toContain(de.file.saveAs);
  });

  it('does not offer to relocate a file that could not be read', () => {
    const markup = render({ kind: 'openFailed', reason: 'invalid', path: PATH, backups: [] });

    expect(markup).not.toContain(de.file.saveAs);
  });

  /**
   * The one notice with no dismiss button. It reports a condition that is still
   * true while the host reads it, and hiding it would mean running the rest of
   * the event with nothing being written (issue #10, "never a silent no-op").
   */
  it('cannot be dismissed while the autosave is broken', () => {
    const markup = render({ kind: 'autosaveFailed', errorKind: 'io' });

    expect(markup).toContain(de.error.autosaveFailed);
    expect(markup).not.toContain(de.common.dismiss);
  });

  /**
   * A pulled USB stick is a pulled USB stick whether the host clicked save or
   * not — the named causes stay, and only the fallback advice changes, because
   * "versuchen Sie es erneut" is advice about a button nobody pressed.
   */
  it('names the cause of a failed autosave when there is a named one', () => {
    expect(render({ kind: 'autosaveFailed', errorKind: 'notFound' })).toContain(
      de.error.fileMissing,
    );
    expect(render({ kind: 'autosaveFailed', errorKind: 'permissionDenied' })).toContain(
      de.error.fileLocked,
    );
    expect(render({ kind: 'autosaveFailed', errorKind: 'io' })).not.toContain(de.error.saveFailed);
  });

  /**
   * Issue #12 acceptance criterion: a file claiming a schema version this build
   * does not know is refused cleanly. The way out is the newer WattMatt, and
   * deliberately *not* a backup — the rotated backups beside it were written by
   * the same build and refuse in exactly the same way.
   */
  it('sends the host to the newer version for a file from the future', () => {
    const markup = render({ kind: 'openFailed', reason: 'futureVersion', path: PATH, backups: [] });

    expect(markup).toContain(de.error.fileFromNewerVersion);
    expect(markup).toContain('neueren Version von WattMatt');
    expect(markup).not.toContain(de.file.openBackup);
    expect(markup).not.toContain(de.file.noBackup);
  });

  it('offers no backup for a file from the future even when one exists', () => {
    const markup = render({
      kind: 'openFailed',
      reason: 'futureVersion',
      path: PATH,
      backups: [BACKUP],
    });

    expect(markup).not.toContain(de.file.openBackup);
  });

  it('separates a file that could not be migrated from one that is corrupt', () => {
    const markup = render({
      kind: 'openFailed',
      reason: 'migrationFailed',
      path: PATH,
      backups: [BACKUP],
    });

    expect(markup).toContain(de.error.fileMigrationFailed);
    expect(markup).not.toContain(de.error.fileInvalid);
    // This one *is* answerable with a backup: the file beside it was written by
    // a build that could read it.
    expect(markup).toContain(de.file.openBackup);
  });

  /**
   * A migration is not a failure — the tournament is open. It is still said out
   * loud, because the file is about to be written in a format the host's other
   * laptop may not read, and because the copy of the original is only useful to
   * someone who knows it is there.
   */
  it('reports a migrated file as news rather than as a failure', () => {
    const markup = render({ kind: 'migrated', from: 1 });

    expect(markup).toContain(de.file.migrated({ from: 1 }));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain(de.common.dismiss);
    // Nothing failed, so there is nothing to relocate and no backup to reach for.
    expect(markup).not.toContain(de.file.saveAs);
    expect(markup).not.toContain(de.file.openBackup);
  });
});
