import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { ZodType } from 'zod';

/**
 * The IPC boundary.
 *
 * Everything crossing it is parsed with Zod (CLAUDE.md §4). Rust and TypeScript
 * are compiled separately and nothing checks that their shapes still match, so
 * "the command returns what I typed it as" is a claim, not a fact — and a
 * silently wrong shape shows up as an undefined halfway through a scene during
 * the event.
 */

/**
 * Whether a Tauri backend is present.
 *
 * `pnpm dev` in a plain browser has no backend, which is a perfectly normal way
 * to work on the UI. Callers use this to degrade instead of throwing.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** A command whose result did not match the schema it was declared with. */
export class IpcContractError extends Error {
  constructor(
    readonly command: string,
    override readonly cause: unknown,
  ) {
    super(`IPC command "${command}" returned an unexpected shape`);
    this.name = 'IpcContractError';
  }
}

/**
 * Calls a Rust command and validates the result.
 *
 * @param command the command name registered in `src-tauri/src/main.rs`
 * @param schema the shape the result must have
 * @param args arguments, camelCase as Tauri expects them
 */
export async function invokeCommand<T>(
  command: string,
  schema: ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  const raw = await invoke(command, args);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new IpcContractError(command, parsed.error);
  }
  return parsed.data;
}

/**
 * Subscribes to a Rust event, validating every payload.
 *
 * A payload that does not parse is dropped rather than delivered: a malformed
 * event is a bug in our own contract, and rendering half of it on the beamer
 * would be worse than rendering the previous, still-correct picture.
 */
export async function listenEvent<T>(
  event: string,
  schema: ZodType<T>,
  onEvent: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen(event, ({ payload }) => {
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      onEvent(parsed.data);
    }
  });
}
