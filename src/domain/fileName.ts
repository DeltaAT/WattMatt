/**
 * Turning a tournament name into a file name, and back
 * (docs/FILE-FORMAT.md §"Location").
 *
 * Pure, and therefore here rather than next to the I/O: what Windows refuses in
 * a file name is a fixed set of rules, and the host would otherwise find out
 * about a broken one at the worst possible moment — the first save of the
 * evening. All of it is unit-testable without touching a disk.
 */

/** Without the dot, matching `TOURNAMENT_EXTENSION` in src-tauri/src/fs.rs. */
export const TOURNAMENT_FILE_EXTENSION = 'wattmatt';

/**
 * Characters Windows refuses outright. `/` is in the list even though it is a
 * separator rather than an illegal character: a tournament called "Gruppe A/B"
 * must become one file, not a directory.
 */
const FORBIDDEN_CHARACTERS = '<>:"/\\|?*';

/** Below this, a code point is a control character and not a file name. */
const FIRST_PRINTABLE = 0x20;

/**
 * Device names Windows still reserves, with or without an extension.
 * `CON.wattmatt` is not a file; it is the console.
 */
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

/**
 * Well under the 255-character limit for one path component. The rest of the
 * path — a deep folder on a USB stick, plus `.wattmatt.bak3` — has to fit in
 * the same budget, and a truncated name is far better than a save that fails
 * during an event.
 */
const MAX_BASE_LENGTH = 80;

/**
 * The file name for a tournament, without a directory.
 *
 * @param name the tournament name as the host typed it
 * @param fallbackBase used when nothing usable survives sanitising — the caller
 *   supplies it from `de-AT.ts`, because a file name is something the host
 *   reads (CLAUDE.md §1)
 */
export function toTournamentFileName(name: string, fallbackBase: string): string {
  const base = toFileBase(name) || toFileBase(fallbackBase) || 'tournament';
  return `${base}.${TOURNAMENT_FILE_EXTENSION}`;
}

/** The tournament name a file name suggests — the start screen's label. */
export function tournamentNameFromFileName(fileName: string): string {
  const withoutDirectory = fileName.split(/[\\/]/).pop() ?? fileName;
  const extension = `.${TOURNAMENT_FILE_EXTENSION}`;
  return withoutDirectory.toLowerCase().endsWith(extension)
    ? withoutDirectory.slice(0, -extension.length)
    : withoutDirectory;
}

/**
 * `name.wattmatt` becomes `name (2).wattmatt` when the library already holds it.
 *
 * The comparison is case-insensitive because the file system is: creating
 * `Turnier.wattmatt` next to `turnier.wattmatt` does not fail on Windows, it
 * overwrites — which during an event is one tournament silently replaced by
 * another.
 */
export function uniqueFileName(fileName: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((entry) => entry.toLowerCase()));
  if (!used.has(fileName.toLowerCase())) {
    return fileName;
  }

  const base = tournamentNameFromFileName(fileName);
  // Bounded rather than `while (true)`: a host with 999 tournaments of the same
  // name has a different problem, and an unbounded loop in the save path hangs
  // the window instead of reporting anything.
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} (${suffix}).${TOURNAMENT_FILE_EXTENSION}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return fileName;
}

/** The sanitised stem, or `''` when the name consisted only of unusable parts. */
function toFileBase(name: string): string {
  const cleaned = collapseSpaces(
    [...name].map((character) => (isUsable(character) ? character : ' ')).join(''),
  )
    .slice(0, MAX_BASE_LENGTH)
    // A trailing dot or space is legal to construct and impossible to open:
    // Windows strips it on create, so the file lands under a different name
    // than the one the host was shown.
    .replace(/[. ]+$/, '')
    .trim();

  return RESERVED.test(cleaned) ? '' : cleaned;
}

function isUsable(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code >= FIRST_PRINTABLE && !FORBIDDEN_CHARACTERS.includes(character);
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
