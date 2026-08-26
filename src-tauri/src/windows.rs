//! Monitor enumeration and host/beamer window placement.
//!
//! See docs/ARCHITECTURE.md §2. Rust owns window and monitor management and
//! nothing else (CLAUDE.md §4) — there is no tournament logic in this file, and
//! opening or closing the beamer never touches tournament state.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const HOST_LABEL: &str = "host";
pub const BEAMER_LABEL: &str = "beamer";

/// The frontend routes on `?window=` (docs/ARCHITECTURE.md §2).
const BEAMER_URL: &str = "index.html?window=beamer";

/// Emitted to every window whenever the beamer placement or the set of attached
/// monitors changes. The host renders it; nothing else may act on it.
pub const BEAMER_STATUS_EVENT: &str = "beamer:status";

/// How often the monitor set is re-read. A projector being unplugged is not
/// something Tauri reports as an event, and the host must not have to click
/// anything to find out — see the "unplug mid-session" acceptance criterion of
/// issue #4. Two seconds is well below the time a human needs to react to a
/// black screen, and enumerating four monitors is far too cheap to profile.
const MONITOR_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// A 16:9 preview, because that is the shape the beamer is laid out for
/// (docs/STYLEGUIDE.md §3).
const PREVIEW_SIZE: LogicalSize<f64> = LogicalSize {
    width: 960.0,
    height: 540.0,
};

/// What went wrong, in a form the frontend can switch on.
///
/// The variant is the contract, exactly as it is for `FileErrorKind`
/// (docs/ARCHITECTURE.md §6): the German sentence is picked from `de-AT.ts` by
/// variant, and the `detail` beside it carries a message from the window system
/// in whatever language Windows is installed in — for the log, never for the
/// host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowErrorKind {
    /// The host window is gone. Nothing can be placed relative to it.
    NoHostWindow,
    /// The window system refused: a monitor that vanished mid-call, a WebView
    /// that would not build.
    WindowSystem,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowError {
    pub kind: WindowErrorKind,
    /// For `%APPDATA%/WattMatt/logs/` (issue #30), never for the host.
    pub detail: String,
}

impl WindowError {
    pub fn no_host_window() -> Self {
        Self {
            kind: WindowErrorKind::NoHostWindow,
            detail: "no window labelled host".to_owned(),
        }
    }
}

impl std::fmt::Display for WindowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.detail)
    }
}

impl From<tauri::Error> for WindowError {
    fn from(error: tauri::Error) -> Self {
        Self {
            kind: WindowErrorKind::WindowSystem,
            detail: error.to_string(),
        }
    }
}

type Result<T> = std::result::Result<T, WindowError>;

/// One attached monitor, in physical pixels.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Stable within one enumeration and, on Windows, across replugs of the
    /// same port (`\\.\DISPLAY2`). Never assume it survives a reboot: every
    /// consumer re-validates it against a freshly enumerated list.
    pub id: String,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// How the beamer window is currently presented.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BeamerPlacement {
    /// Fullscreen and undecorated on a monitor of its own.
    Projected,
    /// A windowed 16:9 preview, because no monitor of its own was available.
    Preview,
}

/// Why the beamer ended up where it is. The host sees this, and it is the
/// difference between "working as intended" and "your projector fell out".
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlacementReason {
    /// A monitor the host picked by hand.
    HostChoice,
    /// A non-primary monitor, chosen automatically.
    AutoSelected,
    /// No second monitor exists at all.
    NoSecondMonitor,
    /// The monitor the host had picked is gone.
    MonitorLost,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeamerStatus {
    pub open: bool,
    pub placement: BeamerPlacement,
    pub reason: PlacementReason,
    /// The monitor the beamer is projected on, or `None` in preview placement.
    pub monitor_id: Option<String>,
    pub monitors: Vec<MonitorInfo>,
}

/// The monitor the host asked for, remembered across close and reopen so that
/// reopening does not send them hunting through the list again.
#[derive(Default)]
pub struct BeamerState {
    requested_monitor_id: Mutex<Option<String>>,
    last_status: Mutex<Option<BeamerStatus>>,
}

// ---------------------------------------------------------------------------
// Monitor enumeration
// ---------------------------------------------------------------------------

/// Windows names monitors `\\.\DISPLAY1`, `\\.\DISPLAY2`, … Where a name is
/// missing we fall back to the origin, which is unique within one enumeration
/// because two monitors cannot share a top-left corner.
fn monitor_id(monitor: &Monitor) -> String {
    match monitor.name() {
        Some(name) if !name.is_empty() => name.clone(),
        _ => format!("@{},{}", monitor.position().x, monitor.position().y),
    }
}

fn describe(monitor: &Monitor, primary_id: Option<&str>) -> MonitorInfo {
    let id = monitor_id(monitor);
    let is_primary = primary_id == Some(id.as_str());
    MonitorInfo {
        name: monitor.name().cloned(),
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale_factor: monitor.scale_factor(),
        is_primary,
        id,
    }
}

fn enumerate_monitors<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<MonitorInfo>> {
    let primary = app.primary_monitor()?.as_ref().map(monitor_id);
    Ok(app
        .available_monitors()?
        .iter()
        .map(|monitor| describe(monitor, primary.as_deref()))
        .collect())
}

/// Picks the monitor the beamer should live on.
///
/// Two rules, both from the edge cases of issue #4:
///
/// * A monitor the host asked for by hand wins, even if it is the laptop
///   screen — an explicit choice is never overruled (CLAUDE.md golden rule 3).
/// * Without such a choice only a **non-primary** monitor is ever picked. If
///   the monitor order changed between sessions and nothing non-primary is
///   left, the beamer falls back to a preview window rather than silently
///   taking over the laptop screen and hiding the host UI.
fn choose_monitor<'a>(
    monitors: &'a [MonitorInfo],
    requested_id: Option<&str>,
) -> Option<(&'a MonitorInfo, PlacementReason)> {
    if let Some(requested) = requested_id {
        if let Some(found) = monitors.iter().find(|monitor| monitor.id == requested) {
            return Some((found, PlacementReason::HostChoice));
        }
    }

    monitors
        .iter()
        .find(|monitor| !monitor.is_primary)
        .map(|monitor| (monitor, fallback_reason(requested_id)))
}

/// The reason to report when the host's remembered monitor was not found.
fn fallback_reason(requested_id: Option<&str>) -> PlacementReason {
    if requested_id.is_some() {
        PlacementReason::MonitorLost
    } else {
        PlacementReason::AutoSelected
    }
}

/// The reason to report when no monitor could be chosen at all.
fn absent_reason(requested_id: Option<&str>) -> PlacementReason {
    if requested_id.is_some() {
        PlacementReason::MonitorLost
    } else {
        PlacementReason::NoSecondMonitor
    }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/// Moves the beamer window onto `target`, fullscreen.
///
/// Fullscreen is dropped first on purpose: a fullscreen window ignores position
/// changes on Windows, so setting the position while still fullscreen would
/// leave the beamer on the old monitor with no visible error.
fn project_on<R: Runtime>(window: &WebviewWindow<R>, target: &MonitorInfo) -> Result<()> {
    window.set_fullscreen(false)?;
    window.set_decorations(false)?;
    window.set_position(PhysicalPosition::new(target.x, target.y))?;
    window.set_size(PhysicalSize::new(target.width, target.height))?;
    window.set_fullscreen(true)?;
    Ok(())
}

/// Demotes the beamer to a windowed preview on the host's screen.
///
/// Decorations stay on here, unlike the projected window: with a single screen
/// the host needs a title bar to move and close it, and an undecorated
/// fullscreen window over the only monitor would bury the control panel
/// (docs/OPEN-QUESTIONS.md 16).
fn preview_on<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    window.set_fullscreen(false)?;
    window.set_decorations(true)?;
    window.set_size(PREVIEW_SIZE)?;
    window.center()?;
    Ok(())
}

fn build_beamer<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>> {
    // The audience must never see chrome, a scrollbar, or a dropped file
    // navigating the view away. The rest of the presentation chrome — no
    // cursor, no selection, no context menu — is CSS and lives in
    // src/windows/beamer/BeamerWindow.tsx.
    //
    // Built invisible and shown by the caller, so the window never appears at
    // its default position before being placed on the projector.
    Ok(
        WebviewWindowBuilder::new(app, BEAMER_LABEL, WebviewUrl::App(BEAMER_URL.into()))
            .title("WattMatt Beamer")
            .decorations(false)
            .resizable(true)
            .disable_drag_drop_handler()
            .visible(false)
            .build()?,
    )
}

/// Opens the beamer if it is closed, then places it. Idempotent: calling it
/// while the beamer is already open only re-places it, so the webview is never
/// reloaded and the scene it shows survives a monitor reassignment.
fn place_beamer<R: Runtime>(
    app: &AppHandle<R>,
    requested_id: Option<&str>,
) -> Result<BeamerStatus> {
    let monitors = enumerate_monitors(app)?;
    let choice = choose_monitor(&monitors, requested_id);

    let window = match app.get_webview_window(BEAMER_LABEL) {
        Some(window) => window,
        None => build_beamer(app)?,
    };

    let status = match choice {
        Some((target, reason)) => {
            project_on(&window, target)?;
            BeamerStatus {
                open: true,
                placement: BeamerPlacement::Projected,
                reason,
                monitor_id: Some(target.id.clone()),
                monitors,
            }
        }
        None => {
            preview_on(&window)?;
            BeamerStatus {
                open: true,
                placement: BeamerPlacement::Preview,
                reason: absent_reason(requested_id),
                monitor_id: None,
                monitors,
            }
        }
    };

    window.show()?;
    Ok(status)
}

fn closed_status<R: Runtime>(
    app: &AppHandle<R>,
    requested_id: Option<&str>,
) -> Result<BeamerStatus> {
    let monitors = enumerate_monitors(app)?;
    let reason = match choose_monitor(&monitors, requested_id) {
        Some((_, reason)) => reason,
        None => absent_reason(requested_id),
    };
    Ok(BeamerStatus {
        open: false,
        placement: BeamerPlacement::Preview,
        reason,
        monitor_id: None,
        monitors,
    })
}

/// Publishes a status to every window, but only when it actually changed: the
/// monitor poller calls this every two seconds and the host must not re-render
/// on a heartbeat.
fn publish<R: Runtime>(app: &AppHandle<R>, status: BeamerStatus) -> Result<BeamerStatus> {
    let state = app.state::<BeamerState>();
    let mut last = state.last_status.lock().expect("beamer status lock");
    if last.as_ref() == Some(&status) {
        return Ok(status);
    }
    *last = Some(status.clone());
    drop(last);
    app.emit(BEAMER_STATUS_EVENT, status.clone())?;
    Ok(status)
}

fn requested_id<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.state::<BeamerState>()
        .requested_monitor_id
        .lock()
        .expect("beamer monitor lock")
        .clone()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_monitors<R: Runtime>(app: AppHandle<R>) -> Result<Vec<MonitorInfo>> {
    enumerate_monitors(&app)
}

/// The current placement. Called by the host on mount, so a host window that
/// was reloaded picks the real state back up instead of guessing.
#[tauri::command]
pub fn beamer_status<R: Runtime>(app: AppHandle<R>) -> Result<BeamerStatus> {
    let requested = requested_id(&app);
    let status = match app.get_webview_window(BEAMER_LABEL) {
        Some(_) => place_beamer(&app, requested.as_deref())?,
        None => closed_status(&app, requested.as_deref())?,
    };
    publish(&app, status)
}

/// Opens the beamer, or moves an already-open one. `monitorId` is the host's
/// explicit choice and is remembered until they choose differently.
#[tauri::command]
pub fn open_beamer<R: Runtime>(
    app: AppHandle<R>,
    monitor_id: Option<String>,
) -> Result<BeamerStatus> {
    if monitor_id.is_some() {
        *app.state::<BeamerState>()
            .requested_monitor_id
            .lock()
            .expect("beamer monitor lock") = monitor_id.clone();
    }
    let requested = monitor_id.or_else(|| requested_id(&app));
    let status = place_beamer(&app, requested.as_deref())?;
    publish(&app, status)
}

/// Closes the beamer window. The tournament is untouched: this window holds no
/// authoritative state (CLAUDE.md golden rule 4).
#[tauri::command]
pub fn close_beamer<R: Runtime>(app: AppHandle<R>) -> Result<BeamerStatus> {
    if let Some(window) = app.get_webview_window(BEAMER_LABEL) {
        window.close()?;
    }
    let requested = requested_id(&app);
    let status = closed_status(&app, requested.as_deref())?;
    publish(&app, status)
}

/// Brings the host window back to the front. With the beamer fullscreen on a
/// second monitor it is easy to lose focus; with a single monitor the preview
/// window can cover the controls outright.
#[tauri::command]
pub fn focus_host<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let window = app
        .get_webview_window(HOST_LABEL)
        .ok_or_else(WindowError::no_host_window)?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Startup and monitor watching
// ---------------------------------------------------------------------------

/// Opens the beamer at startup if — and only if — a monitor of its own exists.
/// With a single screen the app must still come up fully usable, so nothing is
/// opened and the host is told why.
pub fn open_beamer_on_startup<R: Runtime>(app: &AppHandle<R>) -> Result<BeamerStatus> {
    let monitors = enumerate_monitors(app)?;
    let status = if choose_monitor(&monitors, None).is_some() {
        place_beamer(app, None)?
    } else {
        closed_status(app, None)?
    };
    publish(app, status)
}

/// Re-reads the monitor set on a background thread and re-places the beamer
/// when it changed.
///
/// This is what makes unplugging the projector mid-session a non-event: the
/// beamer is demoted to a preview instead of being left fullscreen on the
/// laptop screen, and replugging promotes it straight back.
pub fn watch_monitors<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut known: Option<Vec<MonitorInfo>> = None;
        loop {
            std::thread::sleep(MONITOR_POLL_INTERVAL);

            let Ok(monitors) = enumerate_monitors(&app) else {
                // The event loop is gone, i.e. the app is shutting down.
                return;
            };
            if known.as_deref() == Some(monitors.as_slice()) {
                continue;
            }
            known = Some(monitors);

            let requested = requested_id(&app);
            let status = if app.get_webview_window(BEAMER_LABEL).is_some() {
                place_beamer(&app, requested.as_deref())
            } else {
                closed_status(&app, requested.as_deref())
            };
            if let Ok(status) = status {
                let _ = publish(&app, status);
            }
        }
    });
}

/// Keeps the published status honest when the host closes the beamer through
/// its own title bar instead of through the control panel.
pub fn on_beamer_destroyed<R: Runtime>(app: &AppHandle<R>) {
    let requested = requested_id(app);
    if let Ok(status) = closed_status(app, requested.as_deref()) {
        let _ = publish(app, status);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(id: &str, is_primary: bool) -> MonitorInfo {
        MonitorInfo {
            id: id.to_string(),
            name: Some(id.to_string()),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            is_primary,
        }
    }

    #[test]
    fn auto_selection_skips_the_primary_monitor() {
        let monitors = vec![monitor("laptop", true), monitor("projector", false)];
        let (chosen, reason) = choose_monitor(&monitors, None).expect("a projector is attached");
        assert_eq!(chosen.id, "projector");
        assert_eq!(reason, PlacementReason::AutoSelected);
    }

    #[test]
    fn auto_selection_refuses_the_only_monitor() {
        let monitors = vec![monitor("laptop", true)];
        assert!(choose_monitor(&monitors, None).is_none());
        assert_eq!(absent_reason(None), PlacementReason::NoSecondMonitor);
    }

    #[test]
    fn an_explicit_choice_may_be_the_primary_monitor() {
        let monitors = vec![monitor("laptop", true), monitor("projector", false)];
        let (chosen, reason) = choose_monitor(&monitors, Some("laptop")).expect("host asked");
        assert_eq!(chosen.id, "laptop");
        assert_eq!(reason, PlacementReason::HostChoice);
    }

    #[test]
    fn a_vanished_choice_never_falls_back_to_the_primary_monitor() {
        let monitors = vec![monitor("laptop", true)];
        assert!(choose_monitor(&monitors, Some("projector")).is_none());
        assert_eq!(
            absent_reason(Some("projector")),
            PlacementReason::MonitorLost
        );
    }

    #[test]
    fn a_vanished_choice_moves_to_another_secondary_monitor() {
        let monitors = vec![monitor("laptop", true), monitor("second-projector", false)];
        let (chosen, reason) = choose_monitor(&monitors, Some("projector")).expect("one is free");
        assert_eq!(chosen.id, "second-projector");
        assert_eq!(reason, PlacementReason::MonitorLost);
    }

    #[test]
    fn monitor_order_does_not_decide_the_choice() {
        // Windows enumerates in whatever order the ports were detected. The
        // laptop screen coming first must not make it the beamer.
        let reordered = vec![monitor("projector", false), monitor("laptop", true)];
        let (chosen, _) = choose_monitor(&reordered, None).expect("a projector is attached");
        assert_eq!(chosen.id, "projector");
    }
}
