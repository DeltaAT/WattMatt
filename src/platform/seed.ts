/**
 * Generates the seed a tournament's whole draw stream hangs off
 * (docs/FILE-FORMAT.md `rngSeed`, CLAUDE.md golden rule 7).
 *
 * This lives in `src/platform` rather than `src/domain` for the reason the
 * domain exists at all: it is the one genuinely non-deterministic step. It is
 * called exactly once, when a tournament is created, and the result is written
 * to the file and never changed. Everything after that point is reproducible
 * from `(rngSeed, rngCursor)`.
 *
 * `crypto.getRandomValues` is a local platform API — it reaches the OS entropy
 * pool, not the network, so it is fine in an offline app (CLAUDE.md §2).
 */

/** 128 bits. Far more than a tournament needs; the cost is 32 characters. */
const SEED_BYTES = 16;

export function generateSeed(): string {
  const bytes = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(bytes);

  // Hex rather than base64: the seed is written into a JSON file that
  // docs/FILE-FORMAT.md promises is repairable in Notepad, and hex has no
  // characters that need escaping or that a host might mistake for padding.
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
