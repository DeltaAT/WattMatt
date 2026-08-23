import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de, formatDateTime } from '@/i18n';
import type { RecoveryOffer } from '@/platform/session';
import { RecoveryNotice } from '@/windows/host/RecoveryNotice';

const STARTED_AT = new Date(2026, 7, 22, 19, 31);

const OFFER: RecoveryOffer = {
  path: 'C:\\Users\\host\\AppData\\Roaming\\WattMatt\\tournaments\\Vereinsturnier 2026.wattmatt',
  startedAt: STARTED_AT.getTime(),
};

function render(offer: RecoveryOffer = OFFER, busy = false): string {
  return renderToStaticMarkup(
    <RecoveryNotice offer={offer} busy={busy} onRecover={() => {}} onDecline={() => {}} />,
  );
}

describe('RecoveryNotice', () => {
  /**
   * The host does not need to be told that something went wrong — they were
   * there. They need the tournament back, by the name they gave it.
   */
  it('names the tournament rather than the file it lives in', () => {
    const markup = render();

    expect(markup).toContain('Vereinsturnier 2026');
    expect(markup).not.toContain('.wattmatt');
  });

  it('says when the session it is offering back was running', () => {
    // Through the formatter, not a literal: the time zone is the host's.
    expect(render()).toContain(formatDateTime(STARTED_AT));
  });

  it('offers both answers, and neither of them is a save', () => {
    const markup = render();

    expect(markup).toContain(de.file.recovery.open);
    expect(markup).toContain(de.common.dismiss);
  });

  /**
   * A status, not an alert: nothing is broken. The tournament is sitting where
   * the host left it, and shouting at them about it during setup is how a
   * safety net becomes something they click away without reading.
   */
  it('is a status rather than an alert', () => {
    const markup = render();

    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
  });

  it('does not offer to open anything while a file operation is running', () => {
    expect(render(OFFER, true)).toContain('disabled=""');
  });

  it('survives a path with no directory in front of it', () => {
    expect(render({ path: 'Sommer.wattmatt', startedAt: 0 })).toContain('Sommer');
  });
});
