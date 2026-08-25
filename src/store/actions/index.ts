export {
  closeDocument,
  setDocumentSaved,
  setNewDocument,
  setOpenedDocument,
} from '@/store/actions/document';
export { addGroups, removeGroup, setParticipantLabel } from '@/store/actions/groups';
export { setGroupName } from '@/store/actions/naming';
export { advancePhase } from '@/store/actions/progression';
export {
  acceptRepechageCandidate,
  declineRepechageCandidate,
  drawRepechageCandidate,
  startRepechage,
  useRepechageFallback,
} from '@/store/actions/repechage';
export { closeRound, drawRound, setMatchWinner, startNextMatch } from '@/store/actions/round';
export { blackout, setAutoFollow, showScene } from '@/store/actions/scene';
export { setNamingAt, setPerformanceMode, setTournamentName } from '@/store/actions/settings';
export { startTournament } from '@/store/actions/start';
export {
  addTables,
  disableTable,
  enableTable,
  moveTable,
  removeTable,
  renameTable,
} from '@/store/actions/tables';
