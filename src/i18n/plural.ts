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

/**
 * The same decision without the number in front of it.
 *
 * For the one place a count and its word are drawn apart: the welcome screen's
 * live number is at `beamer-hero` and its label sits under it, so
 * `pluralizeDeAT` would put the figure on the wall twice (issue #74). The rule
 * stays here rather than becoming a `=== 1` in a component — which language
 * says what is `src/i18n`'s business and nothing else's (CLAUDE.md §1).
 */
export function pluralWordDeAT(count: number, singular: string, plural: string): string {
  return pluralRules.select(count) === 'one' ? singular : plural;
}
