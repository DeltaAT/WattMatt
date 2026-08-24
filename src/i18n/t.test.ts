import { describe, expect, it } from 'vitest';

import { t } from '@/i18n';

describe('t()', () => {
  it('looks up a plain string by dotted path', () => {
    expect(t('beamerControl.open')).toBe('Beamer öffnen');
  });

  it('looks up a nested plain string', () => {
    expect(t('beamerControl.status.closed')).toBe(
      'Beamer ist geschlossen. Ein zweiter Bildschirm ist bereit.',
    );
  });

  it('interpolates a count into a template entry', () => {
    expect(t('round.title', { n: 2 })).toBe('Runde 2');
  });

  it('interpolates through the German pluralisation helper', () => {
    expect(t('participant.GROUP.count', { n: 1 })).toBe('1 Gruppe');
    expect(t('participant.GROUP.count', { n: 5 })).toBe('5 Gruppen');
  });

  it('throws for a key that does not resolve to a leaf', () => {
    // @ts-expect-error — "beamerControl" is a namespace, not a leaf; this is
    // also a compile error, which is the point of the typed `Paths<Locale>` key.
    expect(() => t('beamerControl')).toThrow(/does not resolve to a leaf/);
  });

  it('throws for a key that does not exist', () => {
    // @ts-expect-error — compile error too, same reason as above.
    expect(() => t('beamerControl.doesNotExist')).toThrow(/Unknown locale key/);
  });
});
