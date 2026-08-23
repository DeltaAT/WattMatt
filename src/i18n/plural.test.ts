import { describe, expect, it } from 'vitest';

import { pluralizeDeAT } from '@/i18n';

describe('pluralizeDeAT', () => {
  it('uses the singular form for exactly one', () => {
    expect(pluralizeDeAT(1, 'Gruppe', 'Gruppen')).toBe('1 Gruppe');
  });

  it('uses the plural form for zero', () => {
    expect(pluralizeDeAT(0, 'Gruppe', 'Gruppen')).toBe('0 Gruppen');
  });

  it('uses the plural form for more than one', () => {
    expect(pluralizeDeAT(5, 'Gruppe', 'Gruppen')).toBe('5 Gruppen');
  });
});
