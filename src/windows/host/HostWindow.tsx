import { useEffect } from 'react';

import { de } from '@/i18n';
import { setSleepInhibited } from '@/platform/beamerWindow';
import { BeamerControlPanel } from '@/windows/host/BeamerControlPanel';
import { FileNotice } from '@/windows/host/FileNotice';
import { RecoveryNotice } from '@/windows/host/RecoveryNotice';
import { StartScreen } from '@/windows/host/StartScreen';
import { TablePanel } from '@/windows/host/TablePanel';
import { TournamentBar } from '@/windows/host/TournamentBar';
import { UndoControls } from '@/windows/host/UndoControls';
import { UnsavedChangesDialog } from '@/windows/host/UnsavedChangesDialog';
import { useBeamerAlive } from '@/windows/host/useHostSync';
import { useTables } from '@/windows/host/useTables';
import { useTournamentDocument } from '@/windows/host/useTournamentDocument';
import { useUndo, useUndoShortcuts } from '@/windows/host/useUndo';
import { useBeamerStatus } from '@/windows/useBeamerStatus';
import { useNow } from '@/windows/useNow';

/**
 * The control window on the laptop screen (docs/ARCHITECTURE.md §2).
 *
 * Two states: no tournament open, which is the start screen (issue #9), and one
 * open, which grows the real shell — phase navigation on the left, current
 * round in the centre (docs/STYLEGUIDE.md §4) — as the phase issues land. The
 * beamer column is present in both, because the beamer is never hostage to
 * whether a tournament happens to be open (CLAUDE.md golden rule 3).
 */
export function HostWindow() {
  const status = useBeamerStatus();
  // Starts the host half of the snapshot channel for the window's lifetime
  // (docs/ARCHITECTURE.md §3) and reports whether the beamer is answering.
  const beamerAlive = useBeamerAlive();
  const document = useTournamentDocument();
  const undo = useUndo();
  const tables = useTables();
  // Only while something is actually running: a setup screen has no stopwatch
  // to move, and re-rendering it once a second for an hour before the doors
  // open buys nothing.
  const now = useNow(tables.isAnyRunning);

  // Registered for the whole window, not just while the toolbar has focus:
  // the host's hands are on the keyboard between decisions (issue #11).
  useUndoShortcuts(undo);

  useSleepInhibitor(status.open);

  const tournament = document.state.document;

  return (
    <div className="relative flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {tournament === null ? null : (
          <TournamentBar
            name={tournament.name}
            file={document.state.file}
            autosave={document.autosave}
            busy={document.busy}
            onSave={document.save}
            onSaveAs={document.saveAs}
            onClose={document.requestClose}
          />
        )}

        {/*
          Directly under the file bar, and only with a tournament open: the
          history starts at the tournament and does not reach across one
          (docs/OPEN-QUESTIONS.md #20).
        */}
        {tournament === null ? null : <UndoControls {...undo} />}

        {document.notice === null ? null : (
          <FileNotice
            notice={document.notice}
            busy={document.busy}
            onOpenBackup={document.openAt}
            onSaveAs={document.saveAs}
            onDismiss={document.dismissNotice}
          />
        )}

        {/*
          Below the failures, above everything else: a crash recovery is an
          offer the host acts on once, and it must not sit on top of a message
          telling them the disk is not writable right now.
        */}
        {document.recovery === null ? null : (
          <RecoveryNotice
            offer={document.recovery}
            busy={document.busy}
            onRecover={document.recover}
            onDecline={document.declineRecovery}
          />
        )}

        {tournament === null ? (
          <StartScreen
            recents={document.recents}
            library={document.library}
            busy={document.busy}
            onCreate={document.create}
            onOpen={document.openWithDialog}
            onOpenAt={document.openAt}
          />
        ) : (
          <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
            <TablePanel
              board={tables.board}
              groups={document.state.tournament.groups}
              now={now}
              onAdd={tables.add}
              onRename={tables.rename}
              onMove={tables.move}
              onDisable={tables.disable}
              onEnable={tables.enable}
              onRemove={tables.remove}
              onShowOnBeamer={tables.showOnBeamer}
            />

            {/* Groups, rounds and the phase navigation land with #14 and #17. */}
            <p className="text-host-xs text-wm-text-faint">{de.app.bootstrapNotice}</p>
          </main>
        )}
      </div>

      <BeamerControlPanel status={status} beamerAlive={beamerAlive} />

      {document.pendingIntent === null ? null : (
        <UnsavedChangesDialog onAnswer={document.answerUnsaved} />
      )}
    </div>
  );
}

/**
 * Holds off the screensaver and the display timeout while something is on the
 * projector (src-tauri/src/power.rs).
 *
 * "A tournament is running" is the condition the issue names, and there is one
 * to key on now — but an open beamer is still the closer proxy: a tournament
 * being open while the host sets it up in a lit room is not an event, and a
 * beamer that is showing anything is (docs/OPEN-QUESTIONS.md #17).
 */
function useSleepInhibitor(active: boolean): void {
  useEffect(() => {
    setSleepInhibited(active).catch((error: unknown) =>
      console.error('sleep inhibitor unavailable', error),
    );
  }, [active]);

  // Releasing on unmount as well would fight React's strict-mode double-invoke
  // for no benefit: Rust releases the state when the process exits, and the
  // host window living shorter than the app is not a case that exists.
}
