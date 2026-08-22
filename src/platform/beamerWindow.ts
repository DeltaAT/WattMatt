import { z } from 'zod';

import { invokeCommand, isTauriRuntime, listenEvent } from '@/platform/tauri';

/**
 * The window-management half of the Rust boundary: which monitors exist, and
 * where the beamer currently is (src-tauri/src/windows.rs).
 *
 * Nothing here touches tournament state. Opening, moving or closing the beamer
 * is a presentation concern only (CLAUDE.md golden rule 4).
 */

export const monitorInfoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().positive(),
  isPrimary: z.boolean(),
});

export type MonitorInfo = z.infer<typeof monitorInfoSchema>;

/** Fullscreen on a monitor of its own, or a windowed 16:9 preview. */
export const beamerPlacementSchema = z.enum(['projected', 'preview']);
export type BeamerPlacement = z.infer<typeof beamerPlacementSchema>;

/** Why the beamer ended up where it is — the host's headline message. */
export const placementReasonSchema = z.enum([
  'hostChoice',
  'autoSelected',
  'noSecondMonitor',
  'monitorLost',
]);
export type PlacementReason = z.infer<typeof placementReasonSchema>;

export const beamerStatusSchema = z.object({
  open: z.boolean(),
  placement: beamerPlacementSchema,
  reason: placementReasonSchema,
  monitorId: z.string().nullable(),
  monitors: z.array(monitorInfoSchema),
});

export type BeamerStatus = z.infer<typeof beamerStatusSchema>;

/** Emitted by Rust whenever the placement or the monitor set changes. */
export const BEAMER_STATUS_EVENT = 'beamer:status';

/**
 * What the host shows before Rust has answered, and what it keeps showing in a
 * plain browser. Deliberately "closed, no second monitor": the honest reading
 * of "we do not know yet", and the one that makes the host look rather than
 * assume the audience can see something.
 */
export const UNKNOWN_BEAMER_STATUS: BeamerStatus = {
  open: false,
  placement: 'preview',
  reason: 'noSecondMonitor',
  monitorId: null,
  monitors: [],
};

export async function fetchBeamerStatus(): Promise<BeamerStatus> {
  if (!isTauriRuntime()) {
    return UNKNOWN_BEAMER_STATUS;
  }
  return invokeCommand('beamer_status', beamerStatusSchema);
}

/**
 * Opens the beamer, or moves an open one.
 *
 * @param monitorId the monitor the host picked, or `undefined` to let Rust
 *   choose the first non-primary one
 */
export async function openBeamer(monitorId?: string): Promise<BeamerStatus> {
  if (!isTauriRuntime()) {
    return UNKNOWN_BEAMER_STATUS;
  }
  return invokeCommand('open_beamer', beamerStatusSchema, {
    monitorId: monitorId ?? null,
  });
}

export async function closeBeamer(): Promise<BeamerStatus> {
  if (!isTauriRuntime()) {
    return UNKNOWN_BEAMER_STATUS;
  }
  return invokeCommand('close_beamer', beamerStatusSchema);
}

/** Pulls the host window back in front of a fullscreen or preview beamer. */
export async function focusHost(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeCommand('focus_host', z.null().or(z.undefined()));
}

/**
 * Asks Windows not to sleep or start the screensaver.
 *
 * Called with the beamer's open state until there is a tournament to key it on
 * (issue #5 onwards) — see src-tauri/src/power.rs.
 */
export async function setSleepInhibited(active: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeCommand('set_sleep_inhibited', z.null().or(z.undefined()), { active });
}

export async function onBeamerStatus(onStatus: (status: BeamerStatus) => void) {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listenEvent(BEAMER_STATUS_EVENT, beamerStatusSchema, onStatus);
}
