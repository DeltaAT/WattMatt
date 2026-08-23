import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { migrateTournamentFile, readSchemaVersion } from '@/domain/migrations/runner';
import { SCHEMA_VERSION } from '@/domain/schema';

/**
 * Issue #12 acceptance criterion: a file from a historic version still opens.
 *
 * `tests/fixtures/` holds one `.wattmatt` file per released `schemaVersion`,
 * exactly as the build of the day wrote it. They are archives and are never
 * regenerated — see the README next to them. A regenerated fixture proves only
 * that today's writer agrees with today's reader, which every round-trip test
 * in the tree already checks.
 *
 * Today that is one file, and it happens to be current. The test is written to
 * enumerate the directory rather than to name it, so the version after next
 * needs a file dropped in and nothing else.
 */

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));

const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.wattmatt'))
  .sort();

describe('historic tournament files', () => {
  it('has a fixture for every version up to the current one', () => {
    // A version with no fixture is a migration nobody can ever check.
    const versions = files.map((name) => Number(/^v(\d+)\.wattmatt$/.exec(name)?.[1]));

    expect(versions.length, `no fixtures found in ${FIXTURES}`).toBeGreaterThan(0);
    for (const version of versions) {
      expect(Number.isSafeInteger(version), `fixture names are v<n>.wattmatt`).toBe(true);
    }
    expect([...versions].sort((a, b) => a - b)).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_unused, index) => index + 1),
    );
  });

  it.each(files)('%s opens as a tournament this build understands', (name) => {
    const raw = readFileSync(`${FIXTURES}${name}`, 'utf8');
    const json: unknown = JSON.parse(raw);

    const declared = Number(/^v(\d+)\.wattmatt$/.exec(name)?.[1]);
    // The file has to *say* what its name claims, or the fixture is mislabelled
    // and the migration it exercises is not the one anybody thinks it is.
    expect(readSchemaVersion(json, declared)).toEqual({ status: 'current', version: declared });

    const outcome = migrateTournamentFile(json);

    expect(outcome.status, `${name} did not open`).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    expect(outcome.file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(outcome.migratedFrom).toBe(declared === SCHEMA_VERSION ? null : declared);
  });

  /*
   * The fixture is a tournament in the middle of its bracket phase, and this
   * is what says so. Without it a migration that dropped `rounds` wholesale
   * would still pass the test above, because an empty array is valid.
   */
  it.each(files)('%s is a tournament that is actually under way', (name) => {
    const json: unknown = JSON.parse(readFileSync(`${FIXTURES}${name}`, 'utf8'));
    const outcome = migrateTournamentFile(json);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    const file = outcome.file;
    expect(file.groups.length).toBeGreaterThan(1);
    expect(file.tables.length).toBeGreaterThan(1);
    expect(file.rounds.flatMap((round) => round.matches).length).toBeGreaterThan(1);
    expect(file.repechage).not.toBeNull();
    expect(file.bracket?.nodes.length).toBeGreaterThan(1);
    expect(file.log.length).toBeGreaterThan(1);
  });
});
