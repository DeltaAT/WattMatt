export { MIGRATIONS } from '@/domain/migrations/registry';
export {
  applyMigrations,
  CURRENT_SCHEMA,
  migrateToTarget,
  migrateTournamentFile,
  readSchemaVersion,
  type ChainFailure,
  type ChainOutcome,
  type FileVersion,
  type MigrationFailure,
  type MigrationOutcome,
  type SchemaTarget,
} from '@/domain/migrations/runner';
export type { Migration, RawTournamentFile } from '@/domain/migrations/types';
