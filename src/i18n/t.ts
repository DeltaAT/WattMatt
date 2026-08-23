import { deAT, type Locale } from '@/i18n/de-AT';

/**
 * Type-level lookup helpers for `t()`. A leaf is a plain string, or a
 * function `(params) => string` for interpolated text. Everything else in
 * the tree is a namespace to recurse into.
 */
type LeafFn = (params: never) => string;

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string | LeafFn ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type ArgsFor<V> = V extends (params: infer P) => string ? [params: P] : [];

function resolve(path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node !== null && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    throw new Error(`Unknown locale key: "${path}"`);
  }, deAT);
}

/**
 * Look up a locale string by dotted path. `key` autocompletes to every path
 * in `Locale` and is a compile error otherwise; interpolated entries require
 * a matching params object as the second argument.
 *
 * @example t('beamerControl.open')
 * @example t('round.title', { n: 2 })
 */
export function t<P extends Paths<Locale>>(key: P, ...args: ArgsFor<ValueAt<Locale, P>>): string {
  const value = resolve(key);
  if (typeof value === 'function') {
    return (value as (params: unknown) => string)(args[0]);
  }
  if (typeof value === 'string') {
    return value;
  }
  // Reachable only by bypassing the `Paths<Locale>` type, e.g. a computed key.
  throw new Error(`Locale key "${key}" does not resolve to a leaf`);
}
