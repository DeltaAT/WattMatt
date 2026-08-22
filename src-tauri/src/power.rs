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

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

/// Owns the thread that holds the execution state. Lives in Tauri's managed
/// state, so it is dropped only when the app exits — at which point the channel
/// closes, the thread releases the state and ends.
pub struct SleepInhibitor {
    requests: Mutex<Sender<bool>>,
}

impl Default for SleepInhibitor {
    fn default() -> Self {
        Self::new()
    }
}

impl SleepInhibitor {
    pub fn new() -> Self {
        Self::with_applier(apply)
    }

    /// Spawns the thread that owns the execution state. Split out of
    /// [`Self::new`] so tests can observe what would have reached Windows.
    fn with_applier<F>(apply: F) -> Self
    where
        F: Fn(bool) + Send + 'static,
    {
        // Unbounded on purpose. A bounded channel has to discard something once
        // it is full, and `try_send` discards the *incoming* value — so a burst
        // ending in `false` would drop the release and leave
        // ES_DISPLAY_REQUIRED latched for the rest of the session. Requests
        // only happen when the beamer opens or closes, so nothing accumulates.
        let (requests, incoming) = channel::<bool>();

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
        // Fails only once the worker thread is gone, which happens at shutdown
        // after the execution state has already been released.
        let _ = requests.send(active);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::Receiver;
    use std::time::Duration;

    // Generous: these only ever wait on a thread that has already been woken.
    const TIMEOUT: Duration = Duration::from_secs(5);

    struct Harness {
        inhibitor: SleepInhibitor,
        entered: Receiver<()>,
        release: Sender<()>,
        applied: Receiver<bool>,
    }

    /// Parks the worker inside its first `apply` until `release` is sent, so a
    /// test can make requests queue up deterministically, then reports every
    /// value the worker applied.
    fn harness() -> Harness {
        let (applied_tx, applied) = channel::<bool>();
        let (entered_tx, entered) = channel::<()>();
        let (release, release_rx) = channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let first = AtomicBool::new(true);

        let inhibitor = SleepInhibitor::with_applier(move |active| {
            if first.swap(false, Ordering::SeqCst) {
                let _ = entered_tx.send(());
                let _ = release_rx.lock().expect("release lock").recv();
            }
            let _ = applied_tx.send(active);
        });

        Harness {
            inhibitor,
            entered,
            release,
            applied,
        }
    }

    #[test]
    fn requests_reach_windows_in_order() {
        let h = harness();

        h.inhibitor.set(true);
        h.entered.recv_timeout(TIMEOUT).expect("worker started");
        h.inhibitor.set(false);
        h.release.send(()).expect("release worker");

        assert_eq!(h.applied.recv_timeout(TIMEOUT).ok(), Some(true));
        assert_eq!(h.applied.recv_timeout(TIMEOUT).ok(), Some(false));
    }

    /// Regression for the depth-1 `sync_channel`: `try_send` discarded the
    /// *incoming* value once the buffer was full, so the closing `false` was
    /// thrown away and the display stayed forced on for the rest of the
    /// session. Every request must survive a backed-up queue.
    #[test]
    fn a_backed_up_queue_still_delivers_the_final_release() {
        let h = harness();

        h.inhibitor.set(true);
        h.entered.recv_timeout(TIMEOUT).expect("worker started");

        // The worker is parked inside apply(true); these pile up behind it.
        h.inhibitor.set(true);
        h.inhibitor.set(true);
        h.inhibitor.set(false);
        h.release.send(()).expect("release worker");

        let mut applied = Vec::new();
        for _ in 0..4 {
            applied.push(h.applied.recv_timeout(TIMEOUT).expect("applied"));
        }

        assert_eq!(applied, vec![true, true, true, false]);
    }
}
