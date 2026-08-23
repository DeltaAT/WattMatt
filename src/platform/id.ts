/**
 * The one identifier a tournament cannot derive: its own
 * (docs/FILE-FORMAT.md `id`).
 *
 * Here rather than in `src/domain` for the same reason as `seed.ts`: it is
 * non-deterministic, and `src/domain` may not be (ARCHITECTURE.md §5).
 * `createTournament` takes the id as an argument so a test can build the same
 * tournament twice and compare the two.
 *
 * `crypto.getRandomValues` reaches the OS entropy pool, not the network, so it
 * is fine in an offline app (CLAUDE.md §2). `Math.random()` is banned outright
 * (golden rule 7) — and while a tournament id never feeds the draw, using the
 * banned call here would make the claim "no `Math.random()` anywhere" false and
 * leave nothing to enforce it.
 */

/** docs/FILE-FORMAT.md writes ids as `tnm_…`; docs/GLOSSARY.md fixes the term. */
const PREFIX = 'tnm_';

/** 64 bits of hex. Collisions do not matter across files, only within a laptop. */
const ID_BYTES = 8;

export function generateTournamentId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);

  // Hex for the same reason the seed is hex: the id is written into a JSON file
  // that docs/FILE-FORMAT.md promises is repairable in Notepad, and hex has no
  // character that needs escaping.
  return PREFIX + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
