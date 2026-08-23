/**
 * German pluralisation ("1 Gruppe" / "5 Gruppen") for de-AT.ts entries.
 *
 * German only distinguishes `one` from `other` (no dual, no special zero
 * form — `Intl.PluralRules` reports `other` for 0, same as for 2+), so a
 * singular/plural pair is enough; `Intl.PluralRules` decides which applies
 * instead of a hardcoded `count === 1` check, which is wrong for locales with
 * richer plural rules and easy to typo.
 */
const pluralRules = new Intl.PluralRules('de-AT');

export function pluralizeDeAT(count: number, singular: string, plural: string): string {
  const word = pluralRules.select(count) === 'one' ? singular : plural;
  return `${count} ${word}`;
}
