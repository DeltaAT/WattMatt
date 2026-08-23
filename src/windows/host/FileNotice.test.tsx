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
    <FileNotice notice={notice} busy={false} onOpenBackup={() => {}} onDismiss={() => {}} />,
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
});
