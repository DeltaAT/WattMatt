import { de } from '@/i18n';
import { systemClock } from '@/platform/clock';
import { generateTournamentId } from '@/platform/id';
import { generateSeed } from '@/platform/seed';
import {
  listBackups,
  listTournaments,
  pickTournamentSaveTarget,
  pickTournamentToOpen,
  readTournamentFile,
  tournamentsDirectory,
  writeTournamentFile,
  type DialogCopy,
} from '@/platform/tournamentFile';
import type { PersistenceDeps } from '@/store/persistence';

/**
 * The real dependencies behind `@/store/persistence`, wired once.
 *
 * Split from `persistence.ts` so that module stays injectable end to end: every
 * failure the host can hit — a pulled USB stick, a corrupt file, a cancelled
 * dialog — is a branch there, and a branch that can only be reached by
 * unplugging real hardware is a branch nobody tests.
 *
 * It is also where the German copy is attached. `persistence.ts` returns
 * outcomes and knows no strings (CLAUDE.md §1); the dialog titles and the
 * fallback file name are UI text and come from `de-AT.ts`.
 */

const OPEN_COPY: DialogCopy = {
  title: de.file.openDialogTitle,
  filterLabel: de.file.filterLabel,
};

const SAVE_COPY: DialogCopy = {
  title: de.file.saveDialogTitle,
  filterLabel: de.file.filterLabel,
};

export function createPersistenceDeps(appVersion: string): PersistenceDeps {
  return {
    files: {
      read: readTournamentFile,
      write: writeTournamentFile,
      list: listTournaments,
      listBackups,
      directory: tournamentsDirectory,
    },
    dialogs: {
      pickOpen: (directory) => pickTournamentToOpen(OPEN_COPY, directory),
      pickSave: (directory, suggested) => pickTournamentSaveTarget(SAVE_COPY, directory, suggested),
    },
    clock: systemClock,
    newId: generateTournamentId,
    newSeed: generateSeed,
    appVersion,
    fallbackFileBase: de.file.fallbackName,
  };
}

/**
 * The build stamped into every file it writes (docs/FILE-FORMAT.md `app`).
 *
 * Vite substitutes the literal at build time, so a release binary carries the
 * version it was built from rather than reading anything at runtime.
 */
export const APP_VERSION: string = __APP_VERSION__;
