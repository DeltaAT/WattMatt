import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  carriedFields,
  KNOWN_FILE_FIELDS,
  NO_CARRIED_FIELDS,
  SCHEMA_VERSION,
  tournamentFileSchema,
  withCarriedFields,
} from '@/domain/schema';

/**
 * Issue #7 acceptance criterion: the example in docs/FILE-FORMAT.md
 * §"Schema (v1)" round-trips through the schema unchanged.
 *
 * The example is read out of the document rather than copied into a fixture.
 * A copy is a second source of truth that goes stale silently — and the
 * document is the one a host would read while repairing a file in Notepad, so
 * it is the copy that has to be right.
 */

const FILE_FORMAT_DOC = fileURLToPath(new URL('../../docs/FILE-FORMAT.md', import.meta.url));

describe('tournamentFileSchema', () => {
  const example = exampleFromDoc();

  it('accepts the documented example', () => {
    expect(() => tournamentFileSchema.parse(example)).not.toThrow();
  });

  /*
   * Deep equality is the whole assertion for everything *below* the top level:
   * nested objects still parse strictly, so a field added to `settings` or to a
   * `match` in the document but forgotten in the schema fails here rather than
   * being quietly discarded on the host's next save.
   *
   * It no longer says anything about top-level fields — those are preserved on
   * purpose now (issue #12, docs/FILE-FORMAT.md rule 7), so an unknown one
   * would survive this comparison. `covers every top-level field of the
   * documented example` below is the guard that replaces it, and it does not
   * depend on strictness at all.
   */
  it('round-trips it unchanged', () => {
    expect(tournamentFileSchema.parse(example)).toEqual(example);
  });

  /**
   * The replacement for the strictness the top level no longer has
   * (docs/OPEN-QUESTIONS.md #27).
   *
   * Both directions matter. A field in the document that the schema has never
   * heard of would be carried as an unknown one and never reach the store —
   * the host would edit a tournament with a section missing. A field in the
   * schema that the document does not mention is a file format nobody can
   * repair in Notepad, which is the promise FILE-FORMAT.md §Encoding makes.
   */
  it('covers every top-level field of the documented example', () => {
    expect([...KNOWN_FILE_FIELDS].sort()).toEqual(Object.keys(example).sort());
  });

  it('survives a JSON serialisation round-trip', () => {
    const parsed = tournamentFileSchema.parse(example);
    const reparsed: unknown = JSON.parse(JSON.stringify(parsed));
    expect(tournamentFileSchema.parse(reparsed)).toEqual(example);
  });

  it('rejects a file written by a schema version this build does not know', () => {
    const future = { ...example, schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => tournamentFileSchema.parse(future)).toThrow();
  });

  it('rejects a file that is missing a required section', () => {
    const { bracket: _bracket, ...withoutBracket } = example;
    expect(() => tournamentFileSchema.parse(withoutBracket)).toThrow();
  });

  it('rejects a timestamp without an explicit UTC offset', () => {
    // "2026-08-22T17:04:00" is ambiguous across the venue's timezone; the file
    // format requires the offset so a tournament copied to another laptop
    // still reports the times it was actually played at.
    const ambiguous = { ...example, createdAt: '2026-08-22T17:04:00' };
    expect(() => tournamentFileSchema.parse(ambiguous)).toThrow();
  });
});

/**
 * Forward compatibility (docs/FILE-FORMAT.md rule 7, issue #12).
 *
 * The case these serve is a real one the moment a second version exists: a host
 * opens a v2 file on the laptop that still has v1 installed, plays a round and
 * saves. Everything v2 wrote and v1 cannot read has to come back out of that
 * save, or the file has been quietly downgraded by a build that was only ever
 * asked to record a winner.
 */
describe('carried fields', () => {
  const example = exampleFromDoc();

  it('picks up top-level fields this build does not know', () => {
    const fromLater = { ...example, namingDone: true, sponsors: ['Raiffeisen'] };

    expect(carriedFields(fromLater)).toEqual({ namingDone: true, sponsors: ['Raiffeisen'] });
  });

  it('carries nothing from a file this build fully understands', () => {
    expect(carriedFields(example)).toBe(NO_CARRIED_FIELDS);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'not a tournament'],
  ])('carries nothing from %s', (_label, json) => {
    expect(carriedFields(json)).toBe(NO_CARRIED_FIELDS);
  });

  /*
   * `__proto__` arrives as an own property from `JSON.parse`, and writing it
   * back with `=` would set a prototype rather than a field. A hand-edited file
   * does not get to reach into the app that opens it.
   */
  it('refuses to carry __proto__', () => {
    // Built through JSON.parse rather than as a literal: `{ __proto__: … }` in
    // source sets a prototype instead of a key, and the test would prove
    // nothing about the file that actually arrives from disk.
    const hostile: unknown = JSON.parse('{"schemaVersion": 1, "__proto__": {"polluted": true}}');

    expect(carriedFields(hostile)).toBe(NO_CARRIED_FIELDS);

    const written = withCarriedFields(
      tournamentFileSchema.parse(example),
      hostile as Record<string, unknown>,
    );
    expect(written).not.toHaveProperty('polluted');
    expect({}).not.toHaveProperty('polluted');
  });

  it('writes the carried fields back out beside the known ones', () => {
    const file = tournamentFileSchema.parse(example);

    const written = withCarriedFields(file, { namingDone: true });

    expect(written).toEqual({ ...example, namingDone: true });
  });

  /*
   * A carried key that collides with one this build owns is a stale copy of a
   * field the tournament is now authoritative for. Letting it win would put the
   * old value back on every save — the tournament would keep reverting to a
   * name the host changed an hour ago.
   */
  it('never lets a carried field overwrite one this build owns', () => {
    const file = tournamentFileSchema.parse(example);

    const written = withCarriedFields(file, { name: 'Aus einer alten Kopie', phase: 'CEREMONY' });

    expect(written['name']).toBe(file.name);
    expect(written['phase']).toBe(file.phase);
  });

  it('survives a read, a write and a read again', () => {
    const fromLater = { ...example, namingDone: true };

    const carried = carriedFields(fromLater);
    const written = withCarriedFields(tournamentFileSchema.parse(fromLater), carried);
    const reread: unknown = JSON.parse(JSON.stringify(written));

    expect(carriedFields(reread)).toEqual({ namingDone: true });
    expect(tournamentFileSchema.parse(reread)).toEqual(tournamentFileSchema.parse(example));
  });
});

/**
 * The first ```jsonc block of docs/FILE-FORMAT.md, as a plain object.
 */
function exampleFromDoc(): Record<string, unknown> {
  const doc = readFileSync(FILE_FORMAT_DOC, 'utf8');
  const block = /```jsonc\r?\n([\s\S]*?)```/.exec(doc);
  if (block?.[1] === undefined) {
    throw new Error(`No jsonc example block found in ${FILE_FORMAT_DOC}`);
  }
  return JSON.parse(stripLineComments(block[1])) as Record<string, unknown>;
}

/**
 * Drop `//` comments, ignoring ones inside string literals.
 *
 * Naive splitting on "//" would corrupt any string containing it. The example
 * has none today, but a test that silently mangles the document it is
 * validating is worse than no test.
 */
function stripLineComments(source: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      // Skip to the newline, which is kept so line numbers still line up.
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    output += char;
  }

  return output;
}
