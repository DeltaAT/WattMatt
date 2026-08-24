import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MIGRATIONS } from '@/domain/migrations/registry';
import {
  applyMigrations,
  CURRENT_SCHEMA,
  migrateToTarget,
  migrateTournamentFile,
  readSchemaVersion,
  type SchemaTarget,
} from '@/domain/migrations/runner';
import type { Migration, RawTournamentFile } from '@/domain/migrations/types';
import { SCHEMA_VERSION, tournamentFileSchema } from '@/domain/schema';

/**
 * Issue #12, and still written against an injected target one version ahead of
 * whatever `SCHEMA_VERSION` happens to be.
 *
 * The real registry is exercised by `fixtures.test.ts`, which opens every
 * archived file through it. What is tested here is the runner's behaviour at
 * the *edge* of the versions that exist: a chain with a hole in it, a step that
 * throws, a step whose result is still not a valid file. None of those can be
 * arranged with real migrations, because a real one that did any of them would
 * be a bug rather than a fixture — so the step and the schema it leads to are
 * simulated, and the code under test is the code that will run the day the next
 * bump lands.
 */

/** A step that adds a field, the way a real migration would. */
function step(from: number, to: number, add: RawTournamentFile = {}): Migration {
  return { from, to, migrate: (file) => ({ ...file, ...add }) };
}

const V1_FILE: RawTournamentFile = { schemaVersion: 1, name: 'Vereinsturnier' };

/**
 * What the tree will look like after the next breaking change: a schema whose
 * version literal has moved on, and one migration that gets a current file
 * there.
 */
const nextSchema = tournamentFileSchema.extend({
  schemaVersion: z.literal(SCHEMA_VERSION + 1),
  /** The kind of field a bump would add: derived, not invented. */
  namingDone: z.boolean(),
});

const currentToNext: Migration = {
  from: SCHEMA_VERSION,
  to: SCHEMA_VERSION + 1,
  migrate: (file) => ({ ...file, namingDone: false }),
};

const NEXT_TARGET: SchemaTarget<z.infer<typeof nextSchema>> = {
  version: SCHEMA_VERSION + 1,
  schema: nextSchema,
  migrations: [currentToNext],
};

describe('readSchemaVersion', () => {
  it('recognises a file written by the schema being read', () => {
    expect(readSchemaVersion({ schemaVersion: SCHEMA_VERSION })).toEqual({
      status: 'current',
      version: SCHEMA_VERSION,
    });
  });

  it('recognises a file from a newer build', () => {
    // Issue #12 acceptance criterion: the hand-edited file claiming 99.
    expect(readSchemaVersion({ schemaVersion: 99 })).toEqual({ status: 'tooNew', version: 99 });
  });

  it('recognises a file from an older build', () => {
    // Read from a v2 build's vantage point, which is the case the whole
    // framework exists for and the one today's constant cannot produce.
    expect(readSchemaVersion({ schemaVersion: 1 }, 2)).toEqual({ status: 'outdated', version: 1 });
  });

  /*
   * Everything a Notepad repair can produce. The version is read before the
   * schema runs, so it is the first thing standing between a mangled file and
   * a migration chain being pointed at it.
   */
  it.each([
    ['no version at all', { name: 'Vereinsturnier' }],
    ['a version that is text', { schemaVersion: '1' }],
    ['a fractional version', { schemaVersion: 1.5 }],
    ['a zero version', { schemaVersion: 0 }],
    ['a negative version', { schemaVersion: -1 }],
    ['an array', [1, 2, 3]],
    ['null', null],
    ['a bare string', 'not a tournament'],
  ])('refuses %s', (_label, json) => {
    expect(readSchemaVersion(json)).toEqual({ status: 'unversioned' });
  });
});

describe('applyMigrations', () => {
  it('does nothing to a file that is already at the target', () => {
    expect(applyMigrations(V1_FILE, { migrations: [], target: 1 })).toEqual({
      status: 'ok',
      file: V1_FILE,
    });
  });

  it('chains every step from the file version up to the target', () => {
    const outcome = applyMigrations(V1_FILE, {
      migrations: [step(1, 2, { addedInV2: true }), step(2, 3, { addedInV3: true })],
      target: 3,
    });

    expect(outcome).toEqual({
      status: 'ok',
      file: { schemaVersion: 3, name: 'Vereinsturnier', addedInV2: true, addedInV3: true },
    });
  });

  it('runs the steps in version order, whatever order the registry lists them in', () => {
    const order: number[] = [];
    const record = (from: number, to: number): Migration => ({
      from,
      to,
      migrate: (file) => {
        order.push(from);
        return file;
      },
    });

    applyMigrations(V1_FILE, { migrations: [record(2, 3), record(1, 2)], target: 3 });

    expect(order).toEqual([1, 2]);
  });

  it('stamps the version the step declares, even if the step forgot to', () => {
    // A migration that transforms the payload and forgets the stamp would
    // otherwise be looked up again on the next pass, or leave a v2 file
    // calling itself v1 for the next build to misread.
    const forgetful: Migration = { from: 1, to: 2, migrate: (file) => ({ ...file }) };

    expect(applyMigrations(V1_FILE, { migrations: [forgetful], target: 2 })).toEqual({
      status: 'ok',
      file: { schemaVersion: 2, name: 'Vereinsturnier' },
    });
  });

  it('leaves the file it was given untouched', () => {
    // The caller still has to be able to report against the file on disk.
    const original = structuredClone(V1_FILE);

    applyMigrations(V1_FILE, { migrations: [step(1, 2, { addedInV2: true })], target: 2 });

    expect(V1_FILE).toEqual(original);
  });

  it('fails at the hole when the chain does not reach the target', () => {
    const outcome = applyMigrations(V1_FILE, { migrations: [step(1, 2), step(3, 4)], target: 4 });

    expect(outcome).toEqual({ status: 'failed', reason: 'noStep', at: 2 });
  });

  it('reports a step that threw rather than letting it escape', () => {
    const throwing: Migration = {
      from: 1,
      to: 2,
      migrate: () => {
        throw new Error('v2 needs a field this file never had');
      },
    };

    expect(applyMigrations(V1_FILE, { migrations: [throwing], target: 2 })).toEqual({
      status: 'failed',
      reason: 'stepFailed',
      at: 1,
    });
  });

  it.each([
    ['produced nothing usable', null],
    ['produced an array', []],
  ])('reports a step that %s', (_label, produced) => {
    const broken = { from: 1, to: 2, migrate: () => produced } as unknown as Migration;

    expect(applyMigrations(V1_FILE, { migrations: [broken], target: 2 })).toEqual({
      status: 'failed',
      reason: 'brokenStep',
      at: 1,
    });
  });

  it('refuses a step that does not move the version forward', () => {
    // Without this the loop never terminates, and a live event freezes on the
    // one click that opens a tournament.
    expect(applyMigrations(V1_FILE, { migrations: [step(1, 1)], target: 2 })).toEqual({
      status: 'failed',
      reason: 'brokenStep',
      at: 1,
    });
  });
});

describe('migrateTournamentFile', () => {
  const example = exampleFile();

  it('opens a current-version file without migrating anything', () => {
    const outcome = migrateTournamentFile(example);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    expect(outcome.migratedFrom).toBeNull();
    expect(outcome.file.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('refuses a file from a newer version of WattMatt', () => {
    // Issue #12 acceptance criterion: `schemaVersion: 99` is refused cleanly —
    // no throw, no partial load, a variant the host window has copy for.
    expect(migrateTournamentFile({ ...example, schemaVersion: 99 })).toEqual({
      status: 'failed',
      reason: 'tooNew',
      version: 99,
    });
  });

  it('refuses bytes that carry no schema version', () => {
    expect(migrateTournamentFile({ name: 'Vereinsturnier' })).toEqual({
      status: 'failed',
      reason: 'unreadable',
      version: null,
    });
  });

  it('refuses a current-version file that is not a tournament', () => {
    expect(migrateTournamentFile({ schemaVersion: SCHEMA_VERSION })).toEqual({
      status: 'failed',
      reason: 'unreadable',
      version: SCHEMA_VERSION,
    });
  });

  it('ships a target whose version, schema and registry agree', () => {
    expect(CURRENT_SCHEMA.version).toBe(SCHEMA_VERSION);
    expect(CURRENT_SCHEMA.migrations).toBe(MIGRATIONS);
    expect(CURRENT_SCHEMA.schema.safeParse(example).success).toBe(true);
  });
});

describe('migrateToTarget, at a simulated next version', () => {
  const example = exampleFile();

  it('migrates a current file and validates the result against the next schema', () => {
    const outcome = migrateToTarget(example, NEXT_TARGET);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    expect(outcome.migratedFrom).toBe(SCHEMA_VERSION);
    expect(outcome.file.schemaVersion).toBe(SCHEMA_VERSION + 1);
    expect(outcome.file.namingDone).toBe(false);
    // Nothing the v1 file carried was lost on the way through.
    expect(outcome.file.name).toBe(example['name']);
    expect(outcome.file.rounds).toEqual(example['rounds']);
  });

  it('hands back the migrated JSON so unknown fields can be written out again', () => {
    const outcome = migrateToTarget({ ...example, writtenByV3: 'keep me' }, NEXT_TARGET);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') {
      return;
    }
    expect(outcome.raw['writtenByV3']).toBe('keep me');
  });

  it('reports a chain that could not be run to the end', () => {
    // A `SCHEMA_VERSION` bump whose migration was forgotten looks exactly
    // like this, and it must not reach the host as "your file is corrupt".
    const outcome = migrateToTarget(example, { ...NEXT_TARGET, migrations: [] });

    expect(outcome).toEqual({ status: 'failed', reason: 'chainBroken', version: SCHEMA_VERSION });
  });

  it('reports a migration whose result is still not a valid file', () => {
    const outcome = migrateToTarget(example, {
      ...NEXT_TARGET,
      migrations: [{ from: SCHEMA_VERSION, to: SCHEMA_VERSION + 1, migrate: () => ({}) }],
    });

    expect(outcome).toEqual({ status: 'failed', reason: 'invalidResult', version: SCHEMA_VERSION });
  });
});

describe('MIGRATIONS', () => {
  /*
   * A gap between the oldest supported version and `SCHEMA_VERSION` is a file
   * that opens on the laptop of whoever wrote the migration and refuses on the
   * host's, hours before an event. Cheap to assert, impossible to see by
   * reading an array.
   */
  it('is contiguous up to the current schema version', () => {
    const steps = [...MIGRATIONS].sort((a, b) => a.from - b.from);

    for (const [index, migration] of steps.entries()) {
      expect(migration.to, `step from v${migration.from}`).toBe(migration.from + 1);
      const next = steps[index + 1];
      if (next !== undefined) {
        expect(next.from, `after the step from v${migration.from}`).toBe(migration.to);
      }
    }

    expect(steps.at(-1)?.to ?? SCHEMA_VERSION).toBe(SCHEMA_VERSION);
  });
});

/**
 * A valid current-version file, built the way the app builds one.
 *
 * Deliberately not the fixture in `tests/fixtures/`: that one is an archive of
 * what an *older* build wrote and is read by `fixtures.test.ts`. This one has
 * to move with the schema, which is what makes it useless as a fixture and
 * right here.
 */
function exampleFile(): RawTournamentFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: { name: 'WattMatt', version: '0.1.0' },
    id: 'tnm_1',
    name: 'Vereinsturnier 2026',
    createdAt: '2026-08-22T17:04:00+02:00',
    updatedAt: '2026-08-22T19:31:12+02:00',
    rngSeed: 'seed',
    rngCursor: 42,
    settings: { participantLabel: 'GROUP', namingAt: 16, performanceMode: false },
    phase: 'QUALIFYING',
    tables: [
      {
        id: 'tbl_1',
        label: 'Tisch 1',
        status: 'FREE',
        currentMatchId: null,
        occupiedSince: null,
      },
    ],
    nextTableNumber: 2,
    groups: [{ id: 'grp_1', number: 1, name: null, status: 'ACTIVE' }],
    rounds: [
      {
        id: 'rnd_1',
        index: 1,
        kind: 'QUALIFYING',
        label: 'Runde 1',
        state: 'RUNNING',
        matches: [
          { id: 'mt_1', tableId: null, a: 'grp_1', b: null, winnerId: null, status: 'READY' },
        ],
      },
    ],
    repechage: null,
    bracket: null,
    log: [],
  };
}
