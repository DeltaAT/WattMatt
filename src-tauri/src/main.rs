// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs;
mod logging;
mod power;
mod windows;

use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .manage(windows::BeamerState::default())
        .manage(power::SleepInhibitor::default())
        .invoke_handler(tauri::generate_handler![
            windows::list_monitors,
            windows::beamer_status,
            windows::open_beamer,
            windows::close_beamer,
            windows::focus_host,
            power::set_sleep_inhibited,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // A projector that is already attached should be showing the beamer
            // before the host has clicked anything (docs/ARCHITECTURE.md §2).
            // A failure here must not stop the app from starting: with one
            // screen WattMatt has to stay fully usable, and that is the same
            // code path as "monitor enumeration went wrong".
            if let Err(error) = windows::open_beamer_on_startup(&handle) {
                eprintln!("beamer startup placement failed: {error}");
            }

            windows::watch_monitors(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // The host may close the beamer through its title bar in preview
            // placement. Republishing keeps the control panel from claiming the
            // beamer is still open.
            if matches!(event, WindowEvent::Destroyed) && window.label() == windows::BEAMER_LABEL {
                windows::on_beamer_destroyed(&window.app_handle().clone());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WattMatt");
}
