//! The session marker behind crash recovery (issue #10).
//!
//! The whole mechanism is one file. `%APPDATA%\WattMatt\session.json` is
//! written when the app starts and deleted when it exits cleanly, so a marker
//! that is still there at the next start means the last run ended in a way
//! nobody chose — a crash, a flat battery, a power cut mid-event.
//!
//! It records which tournament that run was autosaving, which is the only
//! reason it is more than a flag: the host does not need to be told that
//! something went wrong, they need the tournament back.
//!
//! Rust owns file I/O and nothing else (CLAUDE.md §4). Whether to *offer* the
//! recovery, and in which words, is the frontend's decision.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::fs as tournament_files;
use crate::fs::FileError;

/// Beside the library, not inside it: `tournaments/` is a folder the host is
/// invited to open in Explorer, and a stray `session.json` in there is noise.
const MARKER_NAME: &str = "session.json";

/// What a running session leaves on disk.
///
/// Deliberately tiny. It is rewritten every time the open tournament changes,
/// and anything expensive to serialise here would be paid for on every
/// "Speichern unter…" during an event.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMarker {
    /// Milliseconds since the epoch, formatted for the host by `@/i18n/format`.
    pub started_at: u64,
    /// The tournament this session was autosaving, or `None` before one was
    /// opened. A crash with nothing open has nothing to recover.
    pub document_path: Option<String>,
}

#[derive(Default)]
pub struct SessionState {
    /// The marker the previous run left behind — `Some` only after an unclean
    /// exit. Read once at startup, because the file is overwritten immediately
    /// afterwards and there is no second chance to find it.
    recovered: Mutex<Option<SessionMarker>>,
    /// This run's marker, kept so a document change can be written without
    /// re-reading the file it is about to replace.
    current: Mutex<Option<SessionMarker>>,
}

fn marker_path() -> Result<PathBuf, FileError> {
    Ok(tournament_files::data_root()?.join(MARKER_NAME))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|since| u64::try_from(since.as_millis()).ok())
        .unwrap_or_default()
}

/// Writes the marker, best effort.
///
/// A marker that could not be written costs a recovery offer after a crash that
/// may never happen. Refusing to start the app over it would cost the event.
fn write_marker(marker: &SessionMarker) {
    let Ok(path) = marker_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(marker) {
        let _ = fs::write(&path, json);
    }
}

/// Picks up the previous run's marker and stamps one for this run.
///
/// The order matters and is the whole trick: the old marker is read *before*
/// the new one replaces it, so the evidence of an unclean exit survives exactly
/// long enough to be turned into an offer.
pub fn begin(state: &SessionState) {
    let previous = marker_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        // A marker we cannot parse is a marker from a build that wrote a
        // different shape, or a half-written one. Either way it is not evidence
        // of a specific tournament, and guessing would send the host to a file
        // that is not theirs.
        .and_then(|raw| serde_json::from_str::<SessionMarker>(&raw).ok());

    *state.recovered.lock().expect("session recovered lock") = previous;

    let marker = SessionMarker {
        started_at: now_ms(),
        document_path: None,
    };
    write_marker(&marker);
    *state.current.lock().expect("session current lock") = Some(marker);
}

/// Deletes the marker. Called on a clean exit, which is what makes its
/// *presence* mean something.
pub fn end(state: &SessionState) {
    if let Ok(path) = marker_path() {
        let _ = fs::remove_file(path);
    }
    *state.current.lock().expect("session current lock") = None;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The previous run's marker, if it ended without deleting one.
///
/// Returned as-is rather than as a boolean: the host is offered the tournament
/// by name, and "something crashed" without one is not an offer they can act on.
#[tauri::command]
pub fn pending_recovery(state: tauri::State<'_, SessionState>) -> Option<SessionMarker> {
    state
        .recovered
        .lock()
        .expect("session recovered lock")
        .clone()
}

/// Forgets the offer, once the host has answered it.
///
/// Only the in-memory copy: this run's marker on disk stays, because the app is
/// still running and a crash in the next minute must still be recoverable.
#[tauri::command]
pub fn dismiss_recovery(state: tauri::State<'_, SessionState>) {
    *state.recovered.lock().expect("session recovered lock") = None;
}

/// Records which tournament this session would want back after a crash.
///
/// Called whenever the open file changes — created, opened, saved elsewhere,
/// closed — rather than on every autosave. The path is what recovery needs, and
/// the state on disk at that path is the autosave's business.
pub fn set_document(state: &SessionState, path: Option<String>) {
    let mut current = state.current.lock().expect("session current lock");
    let marker = SessionMarker {
        // The start time is this run's, not this document's: it is what tells
        // the host *when* the session they lost was running.
        started_at: current.as_ref().map_or_else(now_ms, |it| it.started_at),
        document_path: path,
    };
    write_marker(&marker);
    *current = Some(marker);
}

#[tauri::command]
pub fn mark_session_document(state: tauri::State<'_, SessionState>, path: Option<String>) {
    set_document(&state, path);
}

/// Marks this exit as a chosen one. After this, a restart offers nothing.
#[tauri::command]
pub fn end_session(state: tauri::State<'_, SessionState>) {
    end(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The marker lives at a fixed path under `%APPDATA%`, so these tests point
    /// the whole data root at a scratch directory rather than mocking the file
    /// system. They therefore have to run one at a time: `HOME`/`APPDATA` are
    /// process-wide, and Rust runs tests in threads.
    static GUARD: Mutex<()> = Mutex::new(());

    struct Scratch {
        path: PathBuf,
        previous_appdata: Option<std::ffi::OsString>,
        previous_home: Option<std::ffi::OsString>,
    }

    impl Scratch {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("wattmatt-session-{label}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create scratch");
            let scratch = Self {
                previous_appdata: std::env::var_os("APPDATA"),
                previous_home: std::env::var_os("HOME"),
                path: path.clone(),
            };
            // `data_root()` prefers APPDATA and falls back to HOME; both are
            // pointed here so the test behaves the same on either platform.
            std::env::set_var("APPDATA", &path);
            std::env::set_var("HOME", &path);
            scratch
        }

        fn marker(&self) -> PathBuf {
            marker_path().expect("marker path")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            match &self.previous_appdata {
                Some(value) => std::env::set_var("APPDATA", value),
                None => std::env::remove_var("APPDATA"),
            }
            match &self.previous_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn recovered(state: &SessionState) -> Option<SessionMarker> {
        state
            .recovered
            .lock()
            .expect("session recovered lock")
            .clone()
    }

    #[test]
    fn a_clean_exit_leaves_nothing_to_recover() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let scratch = Scratch::new("clean");

        let first = SessionState::default();
        begin(&first);
        set_document(&first, Some("C:\\t.wattmatt".to_string()));
        end(&first);
        assert!(
            !scratch.marker().exists(),
            "the marker survived a clean exit"
        );

        let second = SessionState::default();
        begin(&second);

        assert_eq!(recovered(&second), None);
    }

    /// Issue #10 acceptance criterion, at this layer: a process that was killed
    /// leaves the marker behind, and the next start finds the tournament it was
    /// working on.
    #[test]
    fn a_session_that_never_ended_is_offered_back_with_its_tournament() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let _scratch = Scratch::new("crash");

        let killed = SessionState::default();
        begin(&killed);
        set_document(&killed, Some("C:\\turniere\\Sommer.wattmatt".to_string()));
        // No `end`: this is the crash.

        let restarted = SessionState::default();
        begin(&restarted);

        let offer = recovered(&restarted).expect("a marker should have survived");
        assert_eq!(
            offer.document_path.as_deref(),
            Some("C:\\turniere\\Sommer.wattmatt")
        );
        assert!(offer.started_at > 0);
    }

    #[test]
    fn a_crash_with_no_tournament_open_offers_no_file() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let _scratch = Scratch::new("crash-empty");

        begin(&SessionState::default());

        let restarted = SessionState::default();
        begin(&restarted);

        assert_eq!(
            recovered(&restarted).expect("marker").document_path,
            None,
            "there was nothing open to recover"
        );
    }

    /// The restart writes its own marker straight away. Without that, a second
    /// crash — the one right after a recovery, which is exactly when a host is
    /// most exposed — would have nothing to offer.
    #[test]
    fn the_new_session_stamps_its_own_marker_immediately() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let scratch = Scratch::new("restamp");

        begin(&SessionState::default());

        assert!(scratch.marker().is_file());
    }

    #[test]
    fn a_marker_that_does_not_parse_is_not_offered_as_a_recovery() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let scratch = Scratch::new("garbage");
        fs::create_dir_all(scratch.marker().parent().expect("parent")).expect("create root");
        fs::write(scratch.marker(), "not json").expect("write garbage");

        let state = SessionState::default();
        begin(&state);

        assert_eq!(recovered(&state), None);
    }

    #[test]
    fn the_start_time_survives_a_change_of_tournament() {
        let _lock = GUARD.lock().unwrap_or_else(|error| error.into_inner());
        let _scratch = Scratch::new("started-at");

        let state = SessionState::default();
        begin(&state);
        let started_at = state
            .current
            .lock()
            .expect("lock")
            .as_ref()
            .expect("marker")
            .started_at;

        set_document(&state, Some("C:\\a.wattmatt".to_string()));
        set_document(&state, Some("C:\\b.wattmatt".to_string()));

        let marker = state.current.lock().expect("lock").clone().expect("marker");
        assert_eq!(marker.started_at, started_at);
        assert_eq!(marker.document_path.as_deref(), Some("C:\\b.wattmatt"));
    }
}
