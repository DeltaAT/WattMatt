//! The rolling log file at `%APPDATA%/WattMatt/logs/` (issue #30).
//!
//! One line per entry, plain text, in a folder the host can open from the app.
//! Plain text and not JSON because of who reads it: the host, after the event,
//! in Notepad, trying to work out what happened at 19:31 — and, later, whoever
//! they send it to. Grep has to work and the first glance has to be legible.
//!
//! Three properties are worth spelling out.
//!
//! **One entry is one line.** Newlines inside a message — a JavaScript stack is
//! all newlines — are folded into `│`, so a stack never looks like a dozen
//! unrelated entries and never breaks a search.
//!
//! **Timestamps are UTC.** Rust has no timezone database without a dependency,
//! and a log that guessed at local time would be wrong for one half of the year.
//! The frontend logs its local clock once at startup (`session.started` in
//! `src/platform/log.ts`), which is what makes the UTC stamps translatable back
//! to the evening the host remembers.
//!
//! **Writing a log entry may not fail loudly.** Every path here returns a typed
//! error the caller is free to ignore, and the callers inside this process do
//! exactly that: an app that crashed because it could not write down that it
//! had crashed is the one failure mode this module must not add.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::fs::{data_root, FileError};

/// Beside `tournaments/`, under the same `%APPDATA%\WattMatt` root — one
/// WattMatt folder rather than two (docs/OPEN-QUESTIONS.md #24).
const LOGS_DIR_NAME: &str = "logs";

/// The file being written right now. The rotated ones are `wattmatt.1.log` …
const LOG_FILE_NAME: &str = "wattmatt.log";
const LOG_FILE_STEM: &str = "wattmatt";

/// How large the current file may get before it is rotated.
///
/// An evening writes kilobytes, not megabytes, so a megabyte is already several
/// events' worth of context — and the rotation is what stops a machine that is
/// logging one failure per second from filling the disk it cannot write to.
const MAX_BYTES: u64 = 1_048_576;

/// How many rotated files are kept behind the current one.
///
/// Five plus the live file is six megabytes at worst, and reaches back further
/// than any single event. Beyond that the entries are from a different evening
/// and nobody is reconstructing them.
const KEPT_FILES: usize = 5;

/// The cap on one entry, in characters.
///
/// A stack trace is worth having; a serialised tournament is not. Truncating is
/// also the practical half of "no personal data beyond entered names": the log
/// carries what this app decides to write, and an entry that ran to kilobytes
/// would be one that had swallowed a payload nobody meant to record.
const MAX_ENTRY_CHARS: usize = 2_000;

/// The first line of every freshly created log file.
///
/// Costs one line and removes the one ambiguity a reader cannot resolve from
/// the entries themselves.
const HEADER: &str = "# WattMatt log. One line per entry. Timestamps are UTC (ISO 8601).";

/// Serialises appends so two windows never interleave inside one line.
///
/// Tauri runs each command on its own thread, and the host and the beamer log
/// independently: without this, the projector's stack trace can land in the
/// middle of the host's.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// How loud an entry is. Matched by `LogLevel` in `src/platform/log.ts`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    /// Fixed width, so the columns line up in Notepad.
    fn label(self) -> &'static str {
        match self {
            Self::Info => "INFO ",
            Self::Warn => "WARN ",
            Self::Error => "ERROR",
        }
    }
}

/// One thing that happened, as the frontend hands it over.
///
/// `event` is a stable code (`beamer.scene-failed`) and `message` is prose.
/// Keeping them apart is what makes the log both greppable and readable.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: LogLevel,
    /// Which window this came from: `host`, `beamer` — or `rust` from here.
    pub source: String,
    pub event: String,
    pub message: String,
    #[serde(default)]
    pub detail: Option<String>,
}

type Result<T> = std::result::Result<T, FileError>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// `%APPDATA%\WattMatt\logs`.
pub fn logs_dir() -> Result<PathBuf> {
    Ok(data_root()?.join(LOGS_DIR_NAME))
}

/// `wattmatt.1.log` … `wattmatt.5.log`, oldest last.
fn rotated_name(index: usize) -> String {
    format!("{LOG_FILE_STEM}.{index}.log")
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/// `2026-08-26T17:31:04.123Z` from milliseconds since the epoch.
///
/// Written out rather than pulled in as a dependency: this is the only date
/// arithmetic in the whole Rust half, it is pure, and it is unit-tested against
/// the boundaries that actually catch bugs — leap years, month ends, the epoch.
pub fn format_timestamp(epoch_millis: i64) -> String {
    let (days, millis_of_day) = split_days(epoch_millis);
    let (year, month, day) = civil_from_days(days);

    let millis = millis_of_day % 1_000;
    let seconds_of_day = millis_of_day / 1_000;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day / 60) % 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Splits epoch milliseconds into whole days and the remainder within the day.
///
/// Euclidean rather than truncating division, so a timestamp before 1970 lands
/// on the previous day with a positive remainder instead of a negative clock.
fn split_days(epoch_millis: i64) -> (i64, i64) {
    const DAY_MS: i64 = 86_400_000;
    (
        epoch_millis.div_euclid(DAY_MS),
        epoch_millis.rem_euclid(DAY_MS),
    )
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's `civil_from_days`).
///
/// The shift to a 1st-of-March-based year is what removes every leap-year
/// special case: February becomes the last month, so the length of the year
/// only ever changes at the end of it.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = (if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    }) as u32;

    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Folds an untrusted string onto one line and caps its length.
///
/// Control characters go too, not only newlines: a carriage return in a log
/// file overwrites the line in a terminal, which is how a message hides the
/// entry before it.
fn one_line(text: &str) -> String {
    let folded: String = text
        .chars()
        .map(|character| {
            if character == '\n' {
                '│'
            } else if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();

    let trimmed = folded.trim();
    if trimmed.chars().count() <= MAX_ENTRY_CHARS {
        return trimmed.to_owned();
    }
    // By character and not by byte: slicing a `String` inside an umlaut panics,
    // and the messages this truncates are the ones with names in them.
    let kept: String = trimmed.chars().take(MAX_ENTRY_CHARS).collect();
    format!("{kept}…")
}

/// The line an entry becomes, without its newline.
pub fn format_line(entry: &LogEntry, epoch_millis: i64) -> String {
    let mut line = format!(
        "{} {} {} {} {}",
        format_timestamp(epoch_millis),
        entry.level.label(),
        one_line(&entry.source),
        one_line(&entry.event),
        one_line(&entry.message),
    );
    if let Some(detail) = entry.detail.as_deref() {
        let detail = one_line(detail);
        if !detail.is_empty() {
            line.push_str(" | ");
            line.push_str(&detail);
        }
    }
    line
}

// ---------------------------------------------------------------------------
// Rotation and writing
// ---------------------------------------------------------------------------

/// Shifts the chain along and frees `wattmatt.log`.
///
/// Best effort throughout: a rotation that only half happened still leaves a
/// file to append to, and refusing to log because an old archive could not be
/// renamed would trade the entries the host needs for the ones they do not.
fn rotate(dir: &Path) {
    let _ = fs::remove_file(dir.join(rotated_name(KEPT_FILES)));
    for index in (1..KEPT_FILES).rev() {
        let from = dir.join(rotated_name(index));
        if from.exists() {
            let _ = fs::rename(&from, dir.join(rotated_name(index + 1)));
        }
    }
    let current = dir.join(LOG_FILE_NAME);
    if current.exists() {
        let _ = fs::rename(&current, dir.join(rotated_name(1)));
    }
}

/// Appends one line to the log in `dir`, rotating first if it would not fit.
///
/// Rotating *before* the write rather than after is what keeps the cap a cap:
/// checking afterwards lets the file exceed `MAX_BYTES` by a whole entry, which
/// for a truncated stack trace is two kilobytes of overshoot every time.
///
/// Takes the directory so the rotation can be tested against a real folder
/// without touching the host's own `%APPDATA%`.
pub fn append_line_in(dir: &Path, line: &str) -> Result<()> {
    fs::create_dir_all(dir).map_err(|error| FileError::from_io(&error, dir))?;

    let path = dir.join(LOG_FILE_NAME);
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let existing = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let incoming = line.len() as u64 + 1;
    if existing > 0 && existing + incoming > MAX_BYTES {
        rotate(dir);
    }

    let fresh = !path.exists();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| FileError::from_io(&error, &path))?;

    if fresh {
        writeln!(file, "{HEADER}").map_err(|error| FileError::from_io(&error, &path))?;
    }
    writeln!(file, "{line}").map_err(|error| FileError::from_io(&error, &path))?;
    Ok(())
}

/// Appends one line to the real log folder.
pub fn append_line(line: &str) -> Result<()> {
    append_line_in(&logs_dir()?, line)
}

/// Milliseconds since the epoch, or 0 on a machine whose clock predates it.
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|since| i64::try_from(since.as_millis()).ok())
        .unwrap_or(0)
}

/// Writes one entry from Rust itself.
///
/// Deliberately infallible: every caller is a place that has just failed, and
/// none of them has anything useful to do about a log that could not be
/// written. What they must never do is fail harder because of it.
pub fn record(level: LogLevel, event: &str, message: &str, detail: Option<&str>) {
    let entry = LogEntry {
        level,
        source: "rust".to_owned(),
        event: event.to_owned(),
        message: message.to_owned(),
        detail: detail.map(str::to_owned),
    };
    let _ = append_line(&format_line(&entry, now_millis()));
}

/// Sends every panic to the log before the process goes.
///
/// The release profile aborts on panic, so this hook is the only record that
/// will exist of the one failure nothing else can catch. Installed once, from
/// `main`, and it chains to the default hook rather than replacing it so a
/// `pnpm tauri dev` console still shows what it always did.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record(LogLevel::Error, "rust.panic", &info.to_string(), None);
        previous(info);
    }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Writes one entry from a WebView.
///
/// Returns the typed `FileError` the rest of the boundary uses, so a log folder
/// that cannot be written is reported in the same German as a tournament that
/// cannot be — but the frontend does not wait on the result, and must not
/// (`src/platform/log.ts`).
#[tauri::command]
pub fn log_event(entry: LogEntry) -> Result<()> {
    append_line(&format_line(&entry, now_millis()))
}

/// Where the log folder is, so the host can be told in so many words.
#[tauri::command]
pub fn log_directory() -> Result<String> {
    Ok(logs_dir()?.to_string_lossy().into_owned())
}

/// Opens the log folder in Explorer — the "Protokoll öffnen" button.
///
/// The folder rather than the file: the rotated archives sit next to the live
/// one, and a host who needs a log at all usually needs the previous one too.
/// Explorer is spawned and not waited on — it reports through exit codes it
/// does not honour, and the host can see for themselves whether a window
/// appeared.
#[tauri::command]
pub fn open_log_directory() -> Result<()> {
    let dir = logs_dir()?;
    fs::create_dir_all(&dir).map_err(|error| FileError::from_io(&error, &dir))?;
    spawn_file_manager(&dir)
}

#[cfg(windows)]
fn spawn_file_manager(dir: &Path) -> Result<()> {
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| FileError::from_io(&error, dir))
}

/// WattMatt ships to Windows only; the fallback exists so the crate still
/// compiles for a `cargo check` on a developer's other machine.
#[cfg(not(windows))]
fn spawn_file_manager(dir: &Path) -> Result<()> {
    Err(FileError::new(
        crate::fs::FileErrorKind::Io,
        "no file manager on this platform",
        Some(dir),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own per test, removed afterwards. The rotation is the
    /// half of this module that only exists on disk, and asserting on it
    /// against the developer's real `%APPDATA%` would make the suite depend on
    /// what was already there.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            // Tests run on several threads at once and the process id is shared
            // between them, so the counter is what keeps two folders apart.
            static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let serial = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "wattmatt-log-{label}-{}-{serial}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entry(level: LogLevel, message: &str, detail: Option<&str>) -> LogEntry {
        LogEntry {
            level,
            source: "host".to_owned(),
            event: "test.event".to_owned(),
            message: message.to_owned(),
            detail: detail.map(str::to_owned),
        }
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap_or_default()
    }

    #[test]
    fn the_epoch_formats_as_the_first_of_january_1970() {
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn milliseconds_survive_the_round_trip() {
        assert_eq!(
            format_timestamp(1_756_229_464_123),
            "2025-08-26T17:31:04.123Z"
        );
    }

    /// The 29th exists in 2024 and does not in 2100, which is the case a naive
    /// "every fourth year" rule gets wrong.
    #[test]
    fn leap_days_land_on_the_right_date() {
        assert_eq!(&format_timestamp(1_709_164_800_000)[..10], "2024-02-29");
        assert_eq!(&format_timestamp(4_107_542_400_000)[..10], "2100-03-01");
    }

    #[test]
    fn the_last_millisecond_of_a_year_stays_in_that_year() {
        assert_eq!(
            format_timestamp(1_767_225_599_999),
            "2025-12-31T23:59:59.999Z"
        );
    }

    /// A clock set before 1970 is a machine with a dead CMOS battery, which is
    /// exactly the machine whose log someone will end up reading.
    #[test]
    fn a_timestamp_before_the_epoch_does_not_produce_a_negative_clock() {
        assert_eq!(format_timestamp(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn a_line_carries_the_level_the_source_the_event_and_the_message() {
        let line = format_line(&entry(LogLevel::Error, "scene failed", None), 0);
        assert_eq!(
            line,
            "1970-01-01T00:00:00.000Z ERROR host test.event scene failed"
        );
    }

    #[test]
    fn a_detail_is_appended_behind_a_separator() {
        let line = format_line(&entry(LogLevel::Info, "opened", Some("C:\\t.wattmatt")), 0);
        assert!(line.ends_with(" | C:\\t.wattmatt"), "{line}");
    }

    #[test]
    fn a_blank_detail_adds_no_separator() {
        let line = format_line(&entry(LogLevel::Info, "opened", Some("   ")), 0);
        assert!(!line.contains('|'), "{line}");
    }

    /// A JavaScript stack is newlines all the way down, and one entry has to
    /// stay one line or every search over the log returns fragments.
    #[test]
    fn a_multiline_detail_becomes_one_line() {
        let line = format_line(
            &entry(LogLevel::Error, "boom", Some("at a\nat b\r\nat c")),
            0,
        );
        assert_eq!(line.lines().count(), 1);
        assert!(line.contains("at a│at b"), "{line}");
    }

    #[test]
    fn an_oversized_detail_is_truncated_rather_than_written_whole() {
        let huge = "x".repeat(MAX_ENTRY_CHARS * 2);
        let line = format_line(&entry(LogLevel::Error, "boom", Some(&huge)), 0);
        assert!(line.ends_with('…'), "truncation marker missing");
        assert!(line.chars().count() < MAX_ENTRY_CHARS + 200);
    }

    /// Multi-byte characters are the reason the cap counts characters and not
    /// bytes: slicing a `String` by byte index inside an umlaut panics, and the
    /// entries this truncates are the ones carrying entered names.
    #[test]
    fn truncation_never_splits_a_character() {
        let huge = "ä".repeat(MAX_ENTRY_CHARS * 2);
        let line = format_line(&entry(LogLevel::Error, "boom", Some(&huge)), 0);
        assert!(line.ends_with('…'), "truncation marker missing");
    }

    #[test]
    fn the_level_labels_are_all_the_same_width() {
        for level in [LogLevel::Info, LogLevel::Warn, LogLevel::Error] {
            assert_eq!(level.label().len(), 5, "{level:?}");
        }
    }

    #[test]
    fn an_entry_parses_without_a_detail_field() {
        let parsed: LogEntry =
            serde_json::from_str(r#"{"level":"warn","source":"beamer","event":"e","message":"m"}"#)
                .expect("entry parses");
        assert_eq!(parsed.level, LogLevel::Warn);
        assert!(parsed.detail.is_none());
    }

    #[test]
    fn a_fresh_log_starts_with_the_header_and_then_the_entry() {
        let dir = TempDir::new("fresh");
        append_line_in(&dir.0, "first").expect("append");

        let contents = read(&dir.0, LOG_FILE_NAME);
        let mut lines = contents.lines();
        assert_eq!(lines.next(), Some(HEADER));
        assert_eq!(lines.next(), Some("first"));
    }

    #[test]
    fn appending_keeps_what_was_there_before() {
        let dir = TempDir::new("append");
        append_line_in(&dir.0, "first").expect("append");
        append_line_in(&dir.0, "second").expect("append");

        let contents = read(&dir.0, LOG_FILE_NAME);
        assert_eq!(contents.lines().count(), 3);
        assert!(contents.contains("first") && contents.contains("second"));
    }

    #[test]
    fn writing_creates_the_log_folder_it_was_pointed_at() {
        let dir = TempDir::new("create");
        let nested = dir.0.join("logs");
        append_line_in(&nested, "first").expect("append");
        assert!(nested.join(LOG_FILE_NAME).exists());
    }

    /// The rotation is the whole point of a *rolling* log: a machine failing
    /// once a second during an event must not fill the disk it is failing on.
    #[test]
    fn a_full_log_rolls_over_into_the_first_archive() {
        let dir = TempDir::new("roll");
        fs::write(dir.0.join(LOG_FILE_NAME), "x".repeat(MAX_BYTES as usize)).expect("seed");

        append_line_in(&dir.0, "after the roll").expect("append");

        assert!(dir.0.join(rotated_name(1)).exists());
        let current = read(&dir.0, LOG_FILE_NAME);
        assert!(current.starts_with(HEADER), "{current}");
        assert!(current.contains("after the roll"));
        assert_eq!(
            read(&dir.0, rotated_name(1).as_str()).len(),
            MAX_BYTES as usize
        );
    }

    #[test]
    fn a_log_that_still_has_room_is_not_rotated() {
        let dir = TempDir::new("room");
        append_line_in(&dir.0, "first").expect("append");
        append_line_in(&dir.0, "second").expect("append");
        assert!(!dir.0.join(rotated_name(1)).exists());
    }

    /// Six roll-overs, and the oldest evening is the one that goes.
    #[test]
    fn rotation_keeps_exactly_the_configured_number_of_archives() {
        let dir = TempDir::new("chain");
        for round in 0..=KEPT_FILES {
            fs::write(dir.0.join(LOG_FILE_NAME), "x".repeat(MAX_BYTES as usize)).expect("seed");
            append_line_in(&dir.0, &format!("round {round}")).expect("append");
        }

        for index in 1..=KEPT_FILES {
            assert!(dir.0.join(rotated_name(index)).exists(), "{index} missing");
        }
        assert!(!dir.0.join(rotated_name(KEPT_FILES + 1)).exists());
    }

    /// Rotation must never be the reason there is nowhere to write: the entry
    /// that triggered the roll-over is the one explaining what just broke.
    #[test]
    fn the_entry_that_triggered_the_rotation_is_the_one_kept() {
        let dir = TempDir::new("kept");
        fs::write(dir.0.join(LOG_FILE_NAME), "x".repeat(MAX_BYTES as usize)).expect("seed");
        append_line_in(&dir.0, "the failure that mattered").expect("append");

        assert!(read(&dir.0, LOG_FILE_NAME).contains("the failure that mattered"));
    }

    #[test]
    fn the_rotated_names_are_numbered_from_one() {
        assert_eq!(rotated_name(1), "wattmatt.1.log");
        assert_eq!(rotated_name(KEPT_FILES), "wattmatt.5.log");
    }
}
