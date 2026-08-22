//! Keeps Windows awake while a tournament is on screen.
//!
//! A screensaver or a display timeout during a live event is exactly the class
//! of failure CLAUDE.md is written against: fifty people looking at a black
//! projector. Windows is told to hold off through `SetThreadExecutionState`.
//!
//! The catch that makes this a module rather than one line: the execution state
//! is **per thread** and is dropped when that thread exits. A Tauri command
//! runs on a pool thread which may well be gone a second later, so the request
//! is handed to one long-lived thread that outlives every command.

use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Mutex;

/// Owns the thread that holds the execution state. Lives in Tauri's managed
/// state, so it is dropped only when the app exits — at which point the channel
/// closes, the thread releases the state and ends.
pub struct SleepInhibitor {
    requests: Mutex<SyncSender<bool>>,
}

impl Default for SleepInhibitor {
    fn default() -> Self {
        Self::new()
    }
}

impl SleepInhibitor {
    pub fn new() -> Self {
        // Depth 1 is enough: the value is a level, not a queue of work, and a
        // sender that would block simply means a newer request is already on
        // its way.
        let (requests, incoming) = sync_channel::<bool>(1);

        std::thread::spawn(move || {
            for active in incoming {
                apply(active);
            }
            // The app is shutting down; hand the machine back to Windows.
            apply(false);
        });

        Self {
            requests: Mutex::new(requests),
        }
    }

    /// `true` while a tournament is being presented, `false` once it is not.
    /// Repeat calls are harmless — Windows treats the state as a level.
    pub fn set(&self, active: bool) {
        let requests = self.requests.lock().expect("sleep inhibitor lock");
        // A full channel means an unread request is already pending; the newer
        // value would win anyway, so dropping this one changes nothing.
        let _ = requests.try_send(active);
    }
}

#[cfg(windows)]
fn apply(active: bool) {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    // ES_CONTINUOUS makes the request stick until it is revoked, rather than
    // resetting the idle timer once. ES_DISPLAY_REQUIRED covers the screensaver
    // and the display timeout, ES_SYSTEM_REQUIRED covers sleep.
    let flags = if active {
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };

    // SAFETY: a plain Win32 call taking a bitflag by value. It touches no
    // memory we own and cannot fail in a way that matters here — a zero return
    // means the state was not set, and the only consequence is that the
    // machine may dim, which is what would have happened anyway.
    unsafe {
        SetThreadExecutionState(flags);
    }
}

/// WattMatt ships to Windows only (CLAUDE.md §1). The stub keeps the crate
/// compiling elsewhere so `cargo check` on a non-Windows machine still says
/// something useful about the rest of the code.
#[cfg(not(windows))]
fn apply(_active: bool) {}

/// Called by the frontend whenever the "is something being presented" condition
/// changes. Until the tournament store exists (issue #5 onwards) that condition
/// is "the beamer window is open", which is the closest available proxy for a
/// running event.
#[tauri::command]
pub fn set_sleep_inhibited(inhibitor: tauri::State<'_, SleepInhibitor>, active: bool) {
    inhibitor.set(active);
}
