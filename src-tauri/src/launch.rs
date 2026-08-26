//! What WattMatt was asked to open when it was started (issue #31).
//!
//! A `.wattmatt` file is registered with the shell, so double-clicking one in
//! Explorer starts the app with the path as an argument — or, if WattMatt is
//! already running, starts a second process that hands the path to the first
//! one and exits.
//!
//! Rust does the smallest possible part of that: it works out *which* argument
//! is a tournament and passes it up. Whether to open it, and what to do when a
//! tournament is already on screen, is the host window's decision — the host is
//! always in control (CLAUDE.md golden rule 3), and a file that replaced a
//! running tournament because somebody double-clicked the wrong icon would be
//! the app taking a decision away mid-event.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::fs::TOURNAMENT_EXTENSION;

/// Emitted to the host when a second instance was asked to open a tournament.
pub const OPEN_REQUEST_EVENT: &str = "launch:open-request";

/// The path a second instance was started with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub path: String,
}

/// The tournament this process was started with, until somebody takes it.
#[derive(Default)]
pub struct LaunchState {
    requested: Mutex<Option<String>>,
}

impl LaunchState {
    /// Reads the command line this process was started with.
    pub fn from_environment() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self {
            requested: Mutex::new(document_from_args(std::env::args(), &cwd)),
        }
    }
}

/// Picks the tournament out of a command line, if there is one.
///
/// Deliberately narrow. The first argument is the executable, anything that
/// looks like a switch belongs to Tauri or to WebView2, and the only thing this
/// app will open unasked is a file the shell would have given its own icon. A
/// rotated backup (`….wattmatt.bak1`) is not one of them: its extension is
/// `bak1`, it is never registered, and opening one by accident would be the app
/// quietly working on the wrong copy (docs/FILE-FORMAT.md rule 3).
pub fn document_from_args<I>(args: I, cwd: &Path) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .find(|argument| {
            Path::new(argument)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case(TOURNAMENT_EXTENSION))
        })
        .map(|argument| resolve(&argument, cwd))
}

/// Explorer passes an absolute path; a command line does not have to.
fn resolve(argument: &str, cwd: &Path) -> String {
    let path = Path::new(argument);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    absolute.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The tournament this process was started with — once.
///
/// Taken rather than read, and that is the point. The host WebView can be
/// reloaded, and a start-up path that survived a reload would reopen the file
/// over whatever the host had done since, discarding it without a question.
#[tauri::command]
pub fn take_startup_document(state: tauri::State<'_, LaunchState>) -> Option<String> {
    state.requested.lock().expect("launch lock").take()
}

// ---------------------------------------------------------------------------
// Second instance
// ---------------------------------------------------------------------------

/// Handles a second WattMatt being started while one is already running.
///
/// One process, always. Two of them would each open a beamer window, fight over
/// the projector, and autosave the same file from two places — the last write
/// winning, which during an event means a round disappearing. So the second
/// process hands over what it was asked to open and exits; this one raises its
/// host window and lets the frontend decide what to do with the path.
pub fn on_second_instance<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: Vec<String>,
    cwd: String,
) {
    use tauri::Emitter;

    if let Err(error) = crate::windows::focus_host(app.clone()) {
        crate::logging::record(
            crate::logging::LogLevel::Warn,
            "launch.focus-failed",
            "a second instance could not raise the host window",
            Some(&error.to_string()),
        );
    }

    let Some(path) = document_from_args(args, Path::new(&cwd)) else {
        return;
    };

    crate::logging::record(
        crate::logging::LogLevel::Info,
        "launch.open-request",
        "a second instance asked for a tournament to be opened",
        Some(&path),
    );

    if let Err(error) = app.emit_to(
        crate::windows::HOST_LABEL,
        OPEN_REQUEST_EVENT,
        OpenRequest { path },
    ) {
        crate::logging::record(
            crate::logging::LogLevel::Warn,
            "launch.open-request-failed",
            "the open request never reached the host window",
            Some(&error.to_string()),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    fn cwd() -> PathBuf {
        PathBuf::from(if cfg!(windows) {
            "C:\\turniere"
        } else {
            "/turniere"
        })
    }

    #[test]
    fn a_double_clicked_tournament_is_what_explorer_passes() {
        let path = if cfg!(windows) {
            "C:\\turniere\\Sommer.wattmatt"
        } else {
            "/turniere/Sommer.wattmatt"
        };

        assert_eq!(
            document_from_args(args(&["WattMatt.exe", path]), &cwd()),
            Some(path.to_string())
        );
    }

    #[test]
    fn a_plain_start_asks_for_nothing() {
        assert_eq!(document_from_args(args(&["WattMatt.exe"]), &cwd()), None);
    }

    /// The executable is argument zero and is never a tournament, however it
    /// happens to be named.
    #[test]
    fn the_executable_itself_is_never_opened() {
        assert_eq!(document_from_args(args(&["Sommer.wattmatt"]), &cwd()), None);
    }

    #[test]
    fn switches_are_not_files() {
        assert_eq!(
            document_from_args(
                args(&["WattMatt.exe", "--webview-flag=x.wattmatt", "-v"]),
                &cwd()
            ),
            None
        );
    }

    #[test]
    fn anything_that_is_not_a_tournament_is_ignored() {
        assert_eq!(
            document_from_args(args(&["WattMatt.exe", "notes.txt"]), &cwd()),
            None
        );
    }

    /// docs/FILE-FORMAT.md rule 3: the rotated copies are not registered with
    /// the shell and must never be opened by accident.
    #[test]
    fn a_rotated_backup_is_not_a_tournament() {
        assert_eq!(
            document_from_args(args(&["WattMatt.exe", "Sommer.wattmatt.bak1"]), &cwd()),
            None
        );
    }

    #[test]
    fn the_extension_is_matched_whatever_its_case() {
        let resolved = document_from_args(args(&["WattMatt.exe", "Sommer.WATTMATT"]), &cwd());
        assert!(resolved.is_some_and(|path| path.ends_with("Sommer.WATTMATT")));
    }

    /// A path from a shortcut or a command line need not be absolute, and the
    /// frontend has no idea what the working directory was.
    #[test]
    fn a_relative_path_is_resolved_against_the_working_directory() {
        let resolved =
            document_from_args(args(&["WattMatt.exe", "Sommer.wattmatt"]), &cwd()).expect("a path");
        assert_eq!(PathBuf::from(&resolved), cwd().join("Sommer.wattmatt"));
    }

    #[test]
    fn the_first_tournament_wins_when_several_are_passed() {
        let resolved =
            document_from_args(args(&["WattMatt.exe", "a.wattmatt", "b.wattmatt"]), &cwd())
                .expect("a path");
        assert!(resolved.ends_with("a.wattmatt"));
    }

    /// Taken once: a reloaded WebView must not reopen the file over whatever
    /// the host has done since.
    #[test]
    fn the_startup_document_is_handed_out_once() {
        let state = LaunchState {
            requested: Mutex::new(Some("C:\\t.wattmatt".to_string())),
        };

        assert_eq!(
            state.requested.lock().expect("lock").take(),
            Some("C:\\t.wattmatt".to_string())
        );
        assert_eq!(state.requested.lock().expect("lock").take(), None);
    }
}
