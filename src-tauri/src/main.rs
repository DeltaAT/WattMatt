// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs;
mod logging;
mod power;
mod session;
mod windows;

use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(windows::BeamerState::default())
        .manage(power::SleepInhibitor::default())
        .manage(session::SessionState::default())
        .invoke_handler(tauri::generate_handler![
            windows::list_monitors,
            windows::beamer_status,
            windows::open_beamer,
            windows::close_beamer,
            windows::focus_host,
            power::set_sleep_inhibited,
            fs::tournaments_directory,
            fs::read_tournament,
            fs::write_tournament,
            fs::list_tournaments,
            fs::list_backups,
            fs::backup_before_migration,
            session::pending_recovery,
            session::dismiss_recovery,
            session::mark_session_document,
            session::end_session,
            logging::log_event,
            logging::log_directory,
            logging::open_log_directory,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // First, so that everything below it is on the record. A panic is
            // the one failure no error boundary and no `catch` can reach, and
            // the release profile aborts on it — without the hook there would
            // be nothing at all to read afterwards (src-tauri/src/logging.rs).
            logging::install_panic_hook();
            logging::record(
                logging::LogLevel::Info,
                "app.started",
                concat!("WattMatt ", env!("CARGO_PKG_VERSION")),
                None,
            );

            // Before anything else: the marker the last run left behind is the
            // only evidence that it crashed, and it is overwritten by this
            // run's own marker in the same call (src-tauri/src/session.rs).
            session::begin(&app.state::<session::SessionState>());

            // A projector that is already attached should be showing the beamer
            // before the host has clicked anything (docs/ARCHITECTURE.md §2).
            // A failure here must not stop the app from starting: with one
            // screen WattMatt has to stay fully usable, and that is the same
            // code path as "monitor enumeration went wrong".
            if let Err(error) = windows::open_beamer_on_startup(&handle) {
                logging::record(
                    logging::LogLevel::Warn,
                    "beamer.startup-placement-failed",
                    "the beamer could not be placed at startup",
                    Some(&error.to_string()),
                );
            }

            windows::watch_monitors(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }

            // The host may close the beamer through its title bar in preview
            // placement. Republishing keeps the control panel from claiming the
            // beamer is still open.
            if window.label() == windows::BEAMER_LABEL {
                windows::on_beamer_destroyed(&window.app_handle().clone());
            }

            // The frontend clears the marker before it destroys the window, so
            // this is a backstop rather than the path. It matters for the exits
            // the frontend never sees — a `destroy` from elsewhere, a shutdown
            // that closed the window for us — where a surviving marker would
            // offer a recovery of a tournament nothing happened to.
            if window.label() == windows::HOST_LABEL {
                session::end(&window.state::<session::SessionState>());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WattMatt");
}
