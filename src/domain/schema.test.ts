import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, tournamentFileSchema } from '@/domain/schema';

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
   * Deep equality is the whole assertion: Zod strips keys it does not know
   * about, so a parsed result that still equals the input proves nothing was
   * dropped. A field added to the document but forgotten in the schema fails
   * here rather than being quietly discarded on the host's next save.
   */
  it('round-trips it unchanged', () => {
    expect(tournamentFileSchema.parse(example)).toEqual(example);
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
