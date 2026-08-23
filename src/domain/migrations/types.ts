/**
 * One step from one `schemaVersion` to the next (docs/FILE-FORMAT.md rule 7).
 *
 * A migration works on the raw JSON, not on a parsed `TournamentFile`, and that
 * is the whole point: the file in front of it was written by a *different*
 * build, so the only schema that ever described it is the one that no longer
 * exists in this codebase. Typing the input would mean typing it against the
 * current shape, which is the one thing it is guaranteed not to have.
 *
 * Steps are pure and go one version at a time. Chaining is the runner's job
 * (`@/domain/migrations/runner`), so a file from v1 reaching v4 is three small
 * transformations that were each written when the reason for them was still
 * fresh — not one function that has to remember four years of decisions.
 */

/** A tournament file as it comes out of `JSON.parse`: keys, and no promises. */
export type RawTournamentFile = Record<string, unknown>;

export interface Migration {
  /** The `schemaVersion` this step reads. */
  readonly from: number;
  /** What it writes. Always `from + 1` — see `assertContiguous` in the runner. */
  readonly to: number;
  /**
   * Returns the migrated file. Must not mutate its input: the runner keeps the
   * original around so a failed step can be reported against the file the host
   * actually has on disk.
   *
   * Throwing is a legitimate outcome — a v2 field that cannot be derived from
   * anything in the v1 file is a refusal, not a guess. The runner turns it into
   * a clean "this file could not be brought up to date".
   */
  readonly migrate: (file: RawTournamentFile) => RawTournamentFile;
}
