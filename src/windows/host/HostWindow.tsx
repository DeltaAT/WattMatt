import { useCallback, useEffect, useState } from 'react';

import { setSleepInhibited } from '@/platform/beamerWindow';
import { reportProblem } from '@/store/problems';
import { BeamerControlPanel } from '@/windows/host/BeamerControlPanel';
import { BracketPanel } from '@/windows/host/BracketPanel';
import { ConsolationPanel } from '@/windows/host/ConsolationPanel';
import { FileNotice } from '@/windows/host/FileNotice';
import { GroupPanel } from '@/windows/host/GroupPanel';
import { NamingPanel } from '@/windows/host/NamingPanel';
import { PhasePanel } from '@/windows/host/PhasePanel';
import { PreStartPanel } from '@/windows/host/PreStartPanel';
import { ProblemToasts } from '@/windows/host/ProblemToasts';
import { RecoveryNotice } from '@/windows/host/RecoveryNotice';
import { RepechagePanel } from '@/windows/host/RepechagePanel';
import { RoundHistoryPanel } from '@/windows/host/RoundHistoryPanel';
import { RoundPanel } from '@/windows/host/RoundPanel';
import { SettingsPanel } from '@/windows/host/SettingsPanel';
import { ShortcutsDialog } from '@/windows/host/ShortcutsDialog';
import { StartScreen } from '@/windows/host/StartScreen';
import { TablePanel } from '@/windows/host/TablePanel';
import { TournamentBar } from '@/windows/host/TournamentBar';
import { UndoControls } from '@/windows/host/UndoControls';
import { UnsavedChangesDialog } from '@/windows/host/UnsavedChangesDialog';
import { useBeamerControl } from '@/windows/host/useBeamerControl';
import { useBeamerShortcuts } from '@/windows/host/useBeamerShortcuts';
import { useBracket } from '@/windows/host/useBracket';
import { useConsolation } from '@/windows/host/useConsolation';
import { useGroups } from '@/windows/host/useGroups';
import { useBeamerAlive } from '@/windows/host/useHostSync';
import { useNaming } from '@/windows/host/useNaming';
import { usePhase } from '@/windows/host/usePhase';
import { usePreStart } from '@/windows/host/usePreStart';
import { useProblems } from '@/windows/host/useProblems';
import { useRepechage } from '@/windows/host/useRepechage';
import { useRound } from '@/windows/host/useRound';
import { useSettings } from '@/windows/host/useSettings';
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
  const groups = useGroups();
  const tables = useTables();
  const settings = useSettings();
  const preStart = usePreStart();
  const round = useRound();
  const repechage = useRepechage();
  const consolation = useConsolation();
  const naming = useNaming();
  const bracket = useBracket();
  const phase = usePhase();
  /*
   * The side event's half of the same three panels (issue #91,
   * docs/TOURNAMENT-RULES.md §10).
   *
   * The `Trostrunde` runs the *same* pipeline — its own `Hoffnungsrunde`, its
   * own elimination rounds, its own tree with a `Spiel um Platz 3` — so it gets
   * the same hooks with the track set the other way rather than panels of its
   * own. Each of them goes quiet on its own (`isActive`) when the side event is
   * not running or has not reached that step, so most of an evening this costs
   * three false booleans and no pixels.
   */
  const consolationPhase = usePhase('CONSOLATION');
  const consolationRepechage = useRepechage('CONSOLATION');
  const consolationBracket = useBracket('CONSOLATION');
  const beamer = useBeamerControl();
  // Everything that failed and is not about a file (issue #30). File outcomes
  // have their own strip above, because they carry a way out.
  const problems = useProblems();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const openShortcuts = useCallback(() => setShowShortcuts(true), []);
  // Only while something is actually running: a setup screen has no stopwatch
  // to move, and re-rendering it once a second for an hour before the doors
  // open buys nothing.
  const now = useNow(tables.isAnyRunning);

  // Registered for the whole window, not just while the toolbar has focus:
  // the host's hands are on the keyboard between decisions (issue #11).
  useUndoShortcuts(undo);

  // The same reasoning, for the projector (issue #28). Two hooks rather than
  // one because undo exists before there is a beamer column to control, and
  // neither should be able to break the other by being registered at all.
  useBeamerShortcuts(beamer, openShortcuts);

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
            {/*
              Above the round, because it answers the question the host is asked
              between rounds — what happens next — and the answer has to be
              readable before the decision rather than after it (issue #22).
            */}
            {phase.isActive ? (
              <PhasePanel phase={phase.phase} step={phase.step} onAdvance={phase.advance} />
            ) : null}

            {/*
              First once the tournament is under way, and absent before it: from
              the draw on, the round is the only thing the host is working in,
              and it must not be below sixty-four group chips when a table comes
              free (issue #17).
            */}
            {round.isActive ? (
              <RoundPanel
                round={round.round}
                board={round.board}
                summary={round.summary}
                groups={round.groups}
                participant={round.participant}
                now={now}
                drawBlockers={round.drawBlockers}
                canDraw={round.canDraw}
                closeBlockers={round.closeBlockers}
                canClose={round.canClose}
                undecided={round.undecided}
                rematches={round.rematches}
                onPreviewDraw={round.previewDraw}
                onDraw={round.draw}
                onSetWinner={round.setWinner}
                onStartNext={round.startNext}
                onClose={round.close}
                onShowOnBeamer={round.showOnBeamer}
              />
            ) : null}

            {/*
              Directly under the round it follows on from, and only when the
              host has something to do about it: the phase is skipped for every
              field that is already a power of two, and a panel explaining that
              it does not apply is a panel in the way (issue #21).
            */}
            {repechage.isActive ? (
              <RepechagePanel
                state={repechage.state}
                target={repechage.target}
                blockers={repechage.blockers}
                canStart={repechage.canStart}
                canDraw={repechage.canDraw}
                groups={repechage.groups}
                participant={repechage.participant}
                onStart={repechage.start}
                onDraw={repechage.drawCandidate}
                onAccept={repechage.accept}
                onDecline={repechage.decline}
                onFallback={repechage.useFallback}
                onShowOnBeamer={repechage.showOnBeamer}
              />
            ) : null}

            {/*
              Directly under the `Hoffnungsrunde`, because that is the order §10
              puts them in: the lottery decides who leaves the loser pool, and
              only then is there a `Trostrunde` field. It stays on screen for
              the rest of the evening beside the main field's panels, because
              from here on the host is running two tournaments at once and
              neither may be behind a tab (issue #73).
            */}
            {consolation.isActive ? (
              <ConsolationPanel
                isOffered={consolation.isOffered}
                fieldSize={consolation.fieldSize}
                blockers={consolation.blockers}
                summary={consolation.summary}
                board={consolation.board}
                roundSummary={consolation.roundSummary}
                groups={consolation.groups}
                participant={consolation.participant}
                now={now}
                drawBlockers={consolation.drawBlockers}
                canDraw={consolation.canDraw}
                closeBlockers={consolation.closeBlockers}
                canClose={consolation.canClose}
                undecided={consolation.undecided}
                rematches={consolation.rematches}
                onStart={consolation.start}
                onDecline={consolation.decline}
                onPreviewDraw={consolation.previewDraw}
                onDraw={consolation.draw}
                onSetWinner={consolation.setWinner}
                onStartNext={consolation.startNext}
                onClose={consolation.close}
                onShowOnBeamer={consolation.showOnBeamer}
              />
            ) : null}

            {/*
              The rest of the side event's pipeline, in the order it reaches
              them: the step out of the phase it is in, its own lottery, and its
              own tree (issue #91, §10). Directly under its board, so the whole
              `Trostrunde` is one contiguous block on the screen — the host is
              running two tournaments at once and must never have to work out
              which of two identical panels belongs to which.

              Each panel is track-qualified in its own heading rather than by
              where it sits, because the two blocks scroll past each other.
            */}
            {consolationPhase.isActive ? (
              <PhasePanel
                phase={consolationPhase.phase}
                step={consolationPhase.step}
                track="CONSOLATION"
                onAdvance={consolationPhase.advance}
              />
            ) : null}

            {consolationRepechage.isActive ? (
              <RepechagePanel
                state={consolationRepechage.state}
                target={consolationRepechage.target}
                blockers={consolationRepechage.blockers}
                canStart={consolationRepechage.canStart}
                canDraw={consolationRepechage.canDraw}
                groups={consolationRepechage.groups}
                participant={consolationRepechage.participant}
                track="CONSOLATION"
                onStart={consolationRepechage.start}
                onDraw={consolationRepechage.drawCandidate}
                onAccept={consolationRepechage.accept}
                onDecline={consolationRepechage.decline}
                onFallback={consolationRepechage.useFallback}
                onShowOnBeamer={consolationRepechage.showOnBeamer}
              />
            ) : null}

            {consolationBracket.isActive ? (
              <BracketPanel
                bracket={consolationBracket.bracket}
                columns={consolationBracket.columns}
                groups={consolationBracket.groups}
                participant={consolationBracket.participant}
                freeTables={consolationBracket.freeTables}
                tables={document.state.tournament.tables}
                playable={consolationBracket.playable}
                field={consolationBracket.field}
                now={now}
                drawBlockers={consolationBracket.drawBlockers}
                canDraw={consolationBracket.canDraw}
                canFinish={consolationBracket.canFinish}
                focus={consolationBracket.focus}
                track="CONSOLATION"
                onPreviewDraw={consolationBracket.previewDraw}
                onDraw={consolationBracket.draw}
                onSetWinner={consolationBracket.setWinner}
                correctionFor={consolationBracket.correctionFor}
                onAssign={consolationBracket.assign}
                onFinish={consolationBracket.finish}
                onFocus={consolationBracket.showOnBeamer}
                /*
                  The side event's own phase, which never reaches `CEREMONY`:
                  the podium is the main tournament's 1/2/3, so the ceremony
                  controls stay off this panel by the same expression that puts
                  them on the other one (§10).
                */
                phase={consolationPhase.phase}
              />
            ) : null}

            {/*
              Under the round and the `Hoffnungsrunde`, because it is what
              follows them in the evening, and above the history because the
              host is typing into it right now (issue #23). Absent until the
              field has fallen to `settings.namingAt`, which is most of the
              tournament (docs/OPEN-QUESTIONS.md #63).
            */}
            {naming.isActive ? (
              <NamingPanel
                state={naming.state}
                participant={naming.participant}
                onRename={naming.rename}
                onShowOnBeamer={naming.showOnBeamer}
              />
            ) : null}

            {/*
              The final phase, under the naming panel it follows on from: from
              the moment the tree can be drawn until the podium, this is the
              panel the host works in (issue #26). Absent for the whole first
              half of the evening, when there is no bracket and no way to draw
              one.
            */}
            {bracket.isActive ? (
              <BracketPanel
                bracket={bracket.bracket}
                columns={bracket.columns}
                groups={bracket.groups}
                participant={bracket.participant}
                freeTables={bracket.freeTables}
                tables={document.state.tournament.tables}
                playable={bracket.playable}
                field={bracket.field}
                now={now}
                drawBlockers={bracket.drawBlockers}
                canDraw={bracket.canDraw}
                canFinish={bracket.canFinish}
                focus={bracket.focus}
                onPreviewDraw={bracket.previewDraw}
                onDraw={bracket.draw}
                onSetWinner={bracket.setWinner}
                correctionFor={bracket.correctionFor}
                onAssign={bracket.assign}
                onFinish={bracket.finish}
                onFocus={bracket.showOnBeamer}
                phase={tournament.phase}
                onShowCeremony={(mode: 'AUTO' | 'STEP', step = 0) =>
                  bracket.showCeremony(mode, step)
                }
                onShowCeremonyStep={bracket.showCeremonyStep}
              />
            ) : null}

            {/*
              Under the two panels it is the record of: the host reads it to
              answer a question from the room, and reaches for it far less often
              than for the round in front of them (issue #22).
            */}
            {phase.isActive ? (
              <RoundHistoryPanel
                history={phase.history}
                groups={phase.groups}
                participant={phase.participant}
                onShowOnBeamer={phase.showRoundOnBeamer}
              />
            ) : null}

            {/*
              Settings first, because they decide the words the panels below are
              written in: a host who runs `Teams` rather than `Gruppen` should
              not read the wrong noun on their way to changing it (issue #15).
            */}
            <SettingsPanel
              name={settings.name}
              settings={settings.settings}
              rngSeed={settings.rngSeed}
              isNamingAtEditable={settings.isNamingAtEditable}
              onRename={settings.rename}
              onParticipantChange={settings.setParticipant}
              onNamingAtChange={settings.setNamingAt}
              onPerformanceModeChange={settings.setPerformanceMode}
              onTableAssignmentOrderChange={settings.setTableAssignmentOrder}
            />

            {/*
              Then groups: the host fills the field before the room has tables
              in it, and the panel order is the order of the evening.
            */}
            <GroupPanel
              groups={groups.groups}
              participant={groups.participant}
              hasStarted={groups.hasStarted}
              canRemove={groups.canRemove}
              onAdd={groups.add}
              onRemove={groups.remove}
              onParticipantChange={groups.setParticipant}
              onShowOnBeamer={groups.showOnBeamer}
            />

            <TablePanel
              board={tables.board}
              groups={document.state.tournament.groups}
              participant={groups.participant}
              now={now}
              canReserve={tables.canReserve}
              onAdd={tables.add}
              onRename={tables.rename}
              onMove={tables.move}
              onReserve={tables.reserve}
              onDisable={tables.disable}
              onEnable={tables.enable}
              onRemove={tables.remove}
              onShowOnBeamer={tables.showOnBeamer}
            />

            {/*
              Last, under everything it checks: the host reads the room, then
              the screen, then presses the one button that ends setup.
            */}
            <PreStartPanel
              report={preStart.report}
              participant={groups.participant}
              onStart={preStart.start}
            />
          </main>
        )}
      </div>

      <BeamerControlPanel
        status={status}
        beamerAlive={beamerAlive}
        control={beamer}
        onShowShortcuts={openShortcuts}
        onOpenLog={problems.openLog}
        logDirectory={problems.directory}
      />

      {showShortcuts ? <ShortcutsDialog onClose={() => setShowShortcuts(false)} /> : null}

      {/*
        Over everything, in the corner, and never in the layout: a message that
        arrived between two rounds must not move the button the host was about
        to press (issue #30). Outside the left column on purpose — a broken
        beamer channel is not news about the tournament, and the host may well
        be looking at the control column when it happens.
      */}
      <ProblemToasts problems={problems.problems} onDismiss={problems.dismiss} />

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
    setSleepInhibited(active).catch((error: unknown) => {
      // A screensaver that comes up mid-final is the audience looking at a
      // lock screen, and it is entirely fixable — in the Windows energy
      // options, by the host, in the twenty minutes before it happens
      // (issue #30).
      reportProblem('sleepInhibitFailed', 'power.sleep-inhibit-failed', error);
    });
  }, [active]);

  // Releasing on unmount as well would fight React's strict-mode double-invoke
  // for no benefit: Rust releases the state when the process exits, and the
  // host window living shorter than the app is not a case that exists.
}
