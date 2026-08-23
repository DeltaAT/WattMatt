//! Atomic tournament file writes, the tournament library and backup discovery.
//!
//! Rust owns file I/O and nothing else (CLAUDE.md §4). There is no tournament
//! logic here: this module moves bytes and never looks inside them. Validation
//! is the frontend's job, because the schema lives in TypeScript
//! (docs/FILE-FORMAT.md rule 1).
//!
//! The one property worth spelling out is rule 2. Every write goes to
//! `name.wattmatt.tmp` in the *same directory*, is flushed with `sync_all`, and
//! only then renamed over the target. Same directory means same volume, which
//! is what makes the rename a metadata swap rather than a copy — and therefore
//! what makes "a power cut never truncates a tournament" true rather than
//! likely.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// The extension the whole app is filtered on, without the dot.
pub const TOURNAMENT_EXTENSION: &str = "wattmatt";

/// Appended to the full file name, so `t.wattmatt` becomes `t.wattmatt.tmp`
/// (docs/FILE-FORMAT.md rule 2) and never collides with a real tournament.
const TEMP_SUFFIX: &str = "tmp";

/// Newest first: `bak1` is the previous save, `bak3` the oldest kept one
/// (docs/FILE-FORMAT.md rule 3). Three is the whole chain — a fourth would only
/// be reached by a host who noticed the problem three saves ago.
const BACKUP_SUFFIXES: [&str; 3] = ["bak1", "bak2", "bak3"];

/// `%APPDATA%\WattMatt`, per docs/FILE-FORMAT.md §"Location".
///
/// Deliberately the product name rather than Tauri's `app_data_dir()`, which
/// would be `%APPDATA%\at.deltadeveloping.wattmatt`. The host is invited to
/// open a tournament in Notepad and to copy one onto a USB stick, and a folder
/// named after a reverse-DNS identifier is not somewhere anyone finds by
/// looking (docs/OPEN-QUESTIONS.md #24).
const DATA_DIR_NAME: &str = "WattMatt";
const TOURNAMENTS_DIR_NAME: &str = "tournaments";

/// What went wrong, in a form the frontend can switch on.
///
/// The variant is the contract (docs/ARCHITECTURE.md §6): German copy is picked
/// from `de-AT.ts` by variant, and `detail` is for the log only — it carries an
/// OS message that no host should ever be shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileErrorKind {
    NotFound,
    PermissionDenied,
    /// The bytes on disk are not valid UTF-8, so this was never our file.
    Encoding,
    /// No `%APPDATA%` (or equivalent) to put a library in.
    NoDataDirectory,
    /// Everything else the OS reported.
    Io,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    pub kind: FileErrorKind,
    /// For `%APPDATA%/WattMatt/logs/` (issue #30), never for the host.
    pub detail: String,
    pub path: Option<String>,
}

impl FileError {
    fn new(kind: FileErrorKind, detail: impl Into<String>, path: Option<&Path>) -> Self {
        Self {
            kind,
            detail: detail.into(),
            path: path.map(|path| path.to_string_lossy().into_owned()),
        }
    }

    fn from_io(error: &std::io::Error, path: &Path) -> Self {
        let kind = match error.kind() {
            std::io::ErrorKind::NotFound => FileErrorKind::NotFound,
            std::io::ErrorKind::PermissionDenied => FileErrorKind::PermissionDenied,
            // `read_to_string` reports invalid UTF-8 as InvalidData.
            std::io::ErrorKind::InvalidData => FileErrorKind::Encoding,
            _ => FileErrorKind::Io,
        };
        Self::new(kind, error.to_string(), Some(path))
    }
}

type Result<T> = std::result::Result<T, FileError>;

/// One tournament in a directory listing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentEntry {
    pub path: String,
    /// With the extension, exactly as it sits on disk.
    pub file_name: String,
    /// Milliseconds since the epoch. Formatted for the host by `@/i18n/format`,
    /// which is where the `de-AT` locale lives — never formatted here.
    pub modified_at: Option<u64>,
    pub bytes: u64,
}

/// One rotated backup of a specific tournament file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    /// `bak1` … `bak3`; `bak1` is the most recent (docs/FILE-FORMAT.md rule 3).
    pub suffix: String,
    pub modified_at: Option<u64>,
    pub bytes: u64,
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// `%APPDATA%\WattMatt`. Public because the session marker of issue #10 lives
/// beside the library rather than inside it — it is not a tournament, and a
/// `session.json` in `tournaments/` would show up in the host's own folder.
pub fn data_root() -> Result<PathBuf> {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return Ok(PathBuf::from(app_data).join(DATA_DIR_NAME));
    }
    // WattMatt ships to Windows only. The fallback exists so `cargo test` on a
    // developer's other machine exercises the same code path instead of a stub.
    if let Some(home) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(home).join(".wattmatt"));
    }
    Err(FileError::new(
        FileErrorKind::NoDataDirectory,
        "neither APPDATA nor HOME is set",
        None,
    ))
}

fn library_dir() -> Result<PathBuf> {
    Ok(data_root()?.join(TOURNAMENTS_DIR_NAME))
}

/// `name.wattmatt` becomes `name.wattmatt.tmp`, in the same directory.
///
/// Appending rather than replacing the extension keeps the temp file out of
/// every `*.wattmatt` listing, and keeps it on the same volume so the rename
/// that follows is atomic.
fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(TEMP_SUFFIX);
    path.with_file_name(name)
}

/// `name.wattmatt` becomes `name.wattmatt.bak1`.
fn backup_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(suffix);
    path.with_file_name(name)
}

/// Milliseconds since the epoch, or `None` where the platform has no answer.
/// A missing timestamp hides a date from the list; it never hides a tournament.
fn modified_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|since| u64::try_from(since.as_millis()).ok())
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

pub fn read_file(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|error| FileError::from_io(&error, path))
}

/// Writes the temp file and flushes it, without touching the target.
///
/// Split out of [`write_atomic`] so the half that may fail is separable from
/// the half that must not: a test can leave a temp file behind and prove the
/// previous tournament is still intact, which is the acceptance criterion
/// "killing the process mid-write leaves the previous file intact".
fn write_temp(path: &Path, contents: &str) -> Result<PathBuf> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| FileError::from_io(&error, parent))?;
        }
    }

    let temp = temp_path(path);
    let mut file = fs::File::create(&temp).map_err(|error| FileError::from_io(&error, &temp))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| FileError::from_io(&error, &temp))?;
    // The whole point of the dance. Without this the rename can land before the
    // data does, and a power cut leaves a valid directory entry over an empty
    // file (docs/FILE-FORMAT.md rule 2).
    file.sync_all()
        .map_err(|error| FileError::from_io(&error, &temp))?;

    Ok(temp)
}

pub fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let temp = write_temp(path, contents)?;

    // `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` on Windows: the target
    // either still holds the old tournament or already holds the new one, never
    // half of either.
    if let Err(error) = fs::rename(&temp, path) {
        // A temp file left lying around would be overwritten by the next write
        // anyway, but removing it keeps a failed save from looking like a
        // half-finished one to anyone reading the folder. Best effort: the
        // write has already failed and that is what the host is about to hear.
        let _ = fs::remove_file(&temp);
        return Err(FileError::from_io(&error, path));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/// Shifts the backup chain along and makes the current file `bak1`
/// (docs/FILE-FORMAT.md rule 3), before the save that is about to replace it.
///
/// Two decisions worth spelling out.
///
/// The chain is walked **oldest first** — `bak2` → `bak3`, then `bak1` →
/// `bak2`, then the tournament → `bak1`. Walking it the other way would move
/// `bak1` onto a `bak2` that has not been shifted yet, and the chain would
/// collapse to one entry that a host only discovers when they need the third.
///
/// The last step is a **copy, not a rename**. A rename would leave the
/// tournament with no file at its own path for the length of the write that
/// follows, and a power cut in that window costs the host the one path they
/// know — the opposite of what a backup is for.
///
/// Every step is best effort. A backup that could not be rotated is a worse
/// backup; a save that was refused because of it is a lost round.
pub fn rotate_backups(path: &Path) {
    // Nothing to rotate before the first save. `is_file` rather than `exists`:
    // a directory sitting on the path is not something to copy anywhere.
    if !path.is_file() {
        return;
    }

    for pair in BACKUP_SUFFIXES.windows(2).rev() {
        let (newer, older) = (pair[0], pair[1]);
        let from = backup_path(path, newer);
        if from.is_file() {
            let _ = fs::rename(&from, backup_path(path, older));
        }
    }

    let _ = fs::copy(path, backup_path(path, BACKUP_SUFFIXES[0]));
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

fn has_tournament_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(TOURNAMENT_EXTENSION))
}

/// Newest first, then by file name.
///
/// The tiebreak is not cosmetic: two tournaments written in the same
/// millisecond would otherwise come back in directory order, and a start screen
/// whose list reshuffles between two visits is one the host stops trusting.
fn sort_entries(entries: &mut [TournamentEntry]) {
    entries.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
}

pub fn list_directory(dir: &Path) -> Result<Vec<TournamentEntry>> {
    // A library that does not exist yet is an empty library, not an error. It
    // appears with the first save, and the start screen has to render before
    // then.
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| FileError::from_io(&error, dir))? {
        // One unreadable directory entry must not hide the other tournaments
        // from a host who is trying to start an event.
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !has_tournament_extension(&path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        entries.push(TournamentEntry {
            path: path.to_string_lossy().into_owned(),
            file_name: entry.file_name().to_string_lossy().into_owned(),
            modified_at: modified_at(&metadata),
            bytes: metadata.len(),
        });
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// The backups that exist for one tournament file, most recent first.
pub fn list_backups_of(path: &Path) -> Vec<BackupEntry> {
    BACKUP_SUFFIXES
        .iter()
        .filter_map(|suffix| {
            let candidate = backup_path(path, suffix);
            let metadata = fs::metadata(&candidate).ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some(BackupEntry {
                path: candidate.to_string_lossy().into_owned(),
                suffix: (*suffix).to_string(),
                modified_at: modified_at(&metadata),
                bytes: metadata.len(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// `%APPDATA%\WattMatt\tournaments`, created if it is not there yet.
///
/// Created here rather than on first save so the native dialogs can actually
/// open in it: a dialog pointed at a directory that does not exist falls back
/// to wherever Windows last was, which is how tournaments end up scattered
/// across a laptop.
#[tauri::command]
pub fn tournaments_directory() -> Result<String> {
    let dir = library_dir()?;
    fs::create_dir_all(&dir).map_err(|error| FileError::from_io(&error, &dir))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_tournament(path: String) -> Result<String> {
    read_file(Path::new(&path))
}

/// Rotates the backups, then writes (docs/FILE-FORMAT.md rules 2 and 3).
///
/// Rotation lives in the command rather than in [`write_atomic`] because it is
/// a property of *saving a tournament*, not of writing a file: the autosave of
/// issue #10 and an explicit "Speichern" are the same call and must both leave
/// a recoverable previous version behind.
#[tauri::command]
pub fn write_tournament(path: String, contents: String) -> Result<()> {
    let path = Path::new(&path);
    rotate_backups(path);
    write_atomic(path, &contents)
}

#[tauri::command]
pub fn list_tournaments() -> Result<Vec<TournamentEntry>> {
    list_directory(&library_dir()?)
}

#[tauri::command]
pub fn list_backups(path: String) -> Result<Vec<BackupEntry>> {
    Ok(list_backups_of(Path::new(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A scratch directory that removes itself. Deliberately not a dependency:
    /// the crate ships to an offline laptop, and every added crate is weight in
    /// an installer that has to fit on a USB stick.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir()
                .join(format!("wattmatt-{label}-{}-{unique}", std::process::id()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entry(file_name: &str, modified_at: Option<u64>) -> TournamentEntry {
        TournamentEntry {
            path: format!("C:\\{file_name}"),
            file_name: file_name.to_string(),
            modified_at,
            bytes: 0,
        }
    }

    #[test]
    fn a_written_tournament_reads_back_byte_for_byte() {
        let dir = TempDir::new("roundtrip");
        let path = dir.join("Vereinsturnier.wattmatt");
        // Umlauts and newlines: the file is UTF-8 and pretty-printed, and a
        // laptop-A-to-laptop-B copy has to survive both.
        let contents = "{\n  \"name\": \"Sommerturnier Grün\"\n}\n";

        write_atomic(&path, contents).expect("write");

        assert_eq!(read_file(&path).expect("read"), contents);
    }

    #[test]
    fn writing_leaves_no_temp_file_behind() {
        let dir = TempDir::new("no-temp");
        let path = dir.join("t.wattmatt");

        write_atomic(&path, "{}").expect("write");

        assert!(!temp_path(&path).exists(), "temp file survived the write");
    }

    #[test]
    fn a_second_write_replaces_the_first() {
        let dir = TempDir::new("replace");
        let path = dir.join("t.wattmatt");

        write_atomic(&path, "first").expect("first write");
        write_atomic(&path, "second").expect("second write");

        assert_eq!(read_file(&path).expect("read"), "second");
    }

    /// Issue #9 acceptance criterion: killing the process mid-write leaves the
    /// previous file intact. A process killed after the temp file was flushed
    /// but before the rename is exactly the state this reproduces.
    #[test]
    fn a_write_interrupted_before_the_rename_leaves_the_previous_file_intact() {
        let dir = TempDir::new("interrupted");
        let path = dir.join("t.wattmatt");
        write_atomic(&path, "the tournament as it stood").expect("first write");

        let temp = write_temp(&path, "half of the next save").expect("temp write");

        assert_eq!(
            read_file(&path).expect("read"),
            "the tournament as it stood"
        );
        assert!(
            temp.exists(),
            "the interrupted write should be the temp file"
        );
        assert_eq!(temp, temp_path(&path));
    }

    /// The temp file must be a sibling. A different directory can be a
    /// different volume, and a cross-volume rename is a copy — which can be
    /// interrupted halfway, which is precisely what rule 2 rules out.
    #[test]
    fn the_temp_file_is_a_sibling_of_the_target() {
        let path = Path::new("C:\\turniere\\t.wattmatt");

        assert_eq!(
            temp_path(path),
            PathBuf::from("C:\\turniere\\t.wattmatt.tmp")
        );
    }

    #[test]
    fn writing_creates_the_directory_it_was_pointed_at() {
        let dir = TempDir::new("mkdir");
        let path = dir.join("nested").join("t.wattmatt");

        write_atomic(&path, "{}").expect("write");

        assert_eq!(read_file(&path).expect("read"), "{}");
    }

    #[test]
    fn reading_a_missing_file_reports_not_found() {
        let dir = TempDir::new("missing");

        let error = read_file(&dir.join("nope.wattmatt")).expect_err("should fail");

        assert_eq!(error.kind, FileErrorKind::NotFound);
        assert!(error.path.is_some());
    }

    #[test]
    fn reading_bytes_that_are_not_utf8_reports_an_encoding_error() {
        let dir = TempDir::new("encoding");
        let path = dir.join("broken.wattmatt");
        fs::write(&path, [0xF0, 0x9F, 0x92]).expect("write raw bytes");

        let error = read_file(&path).expect_err("should fail");

        assert_eq!(error.kind, FileErrorKind::Encoding);
    }

    #[test]
    fn a_library_that_does_not_exist_yet_lists_as_empty() {
        let dir = TempDir::new("empty-library");

        let entries = list_directory(&dir.join("never-created")).expect("list");

        assert!(entries.is_empty());
    }

    #[test]
    fn listing_returns_tournaments_and_ignores_everything_else() {
        let dir = TempDir::new("listing");
        write_atomic(&dir.join("a.wattmatt"), "{}").expect("write a");
        write_atomic(&dir.join("b.wattmatt"), "{}").expect("write b");
        fs::write(dir.join("notes.txt"), "not a tournament").expect("write txt");
        fs::write(dir.join("c.wattmatt.tmp"), "interrupted").expect("write tmp");
        fs::write(dir.join("a.wattmatt.bak1"), "{}").expect("write bak");
        fs::create_dir_all(dir.join("archiv.wattmatt")).expect("create decoy dir");

        let mut names: Vec<String> = list_directory(&dir.0)
            .expect("list")
            .into_iter()
            .map(|entry| entry.file_name)
            .collect();
        names.sort();

        assert_eq!(
            names,
            vec!["a.wattmatt".to_string(), "b.wattmatt".to_string()]
        );
    }

    #[test]
    fn the_listing_is_newest_first_and_breaks_ties_by_name() {
        let mut entries = vec![
            entry("b.wattmatt", Some(10)),
            entry("older.wattmatt", Some(5)),
            entry("a.wattmatt", Some(10)),
            entry("undated.wattmatt", None),
        ];

        sort_entries(&mut entries);

        let names: Vec<&str> = entries.iter().map(|e| e.file_name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "a.wattmatt",
                "b.wattmatt",
                "older.wattmatt",
                "undated.wattmatt"
            ]
        );
    }

    #[test]
    fn backups_come_back_newest_first_and_skip_the_ones_that_do_not_exist() {
        let dir = TempDir::new("backups");
        let path = dir.join("t.wattmatt");
        write_atomic(&path, "{}").expect("write");
        fs::write(backup_path(&path, "bak1"), "one").expect("write bak1");
        // bak2 deliberately absent: rotation has only happened twice.
        fs::write(backup_path(&path, "bak3"), "three").expect("write bak3");

        let suffixes: Vec<String> = list_backups_of(&path)
            .into_iter()
            .map(|backup| backup.suffix)
            .collect();

        assert_eq!(suffixes, vec!["bak1".to_string(), "bak3".to_string()]);
    }

    /// One save, one backup. The tournament that was on disk is what `bak1`
    /// holds — not the one that has just replaced it.
    #[test]
    fn the_first_rotation_copies_the_previous_tournament_into_bak1() {
        let dir = TempDir::new("rotate-first");
        let path = dir.join("t.wattmatt");
        write_atomic(&path, "as it stood").expect("write");

        rotate_backups(&path);
        write_atomic(&path, "as it stands now").expect("second write");

        assert_eq!(read_file(&path).expect("read"), "as it stands now");
        assert_eq!(
            read_file(&backup_path(&path, "bak1")).expect("read bak1"),
            "as it stood"
        );
    }

    /// The chain is walked oldest first. Walking it the other way would move
    /// `bak1` onto an unshifted `bak2` and collapse three recovery points into
    /// one — which a host only finds out when they need the third.
    #[test]
    fn rotation_shifts_the_whole_chain_along() {
        let dir = TempDir::new("rotate-chain");
        let path = dir.join("t.wattmatt");

        for save in ["first", "second", "third", "fourth"] {
            rotate_backups(&path);
            write_atomic(&path, save).expect("write");
        }

        assert_eq!(read_file(&path).expect("read"), "fourth");
        assert_eq!(
            read_file(&backup_path(&path, "bak1")).expect("bak1"),
            "third"
        );
        assert_eq!(
            read_file(&backup_path(&path, "bak2")).expect("bak2"),
            "second"
        );
        assert_eq!(
            read_file(&backup_path(&path, "bak3")).expect("bak3"),
            "first"
        );
    }

    /// Issue #10 acceptance criterion: backups rotate correctly over 50
    /// consecutive saves. The chain stays exactly three deep and always holds
    /// the three saves before the current one — no drift, no fourth file.
    #[test]
    fn fifty_consecutive_saves_leave_exactly_the_last_three_versions() {
        let dir = TempDir::new("rotate-fifty");
        let path = dir.join("t.wattmatt");

        for save in 1..=50 {
            rotate_backups(&path);
            write_atomic(&path, &format!("save {save}")).expect("write");
        }

        assert_eq!(read_file(&path).expect("read"), "save 50");
        let backups = list_backups_of(&path);
        assert_eq!(backups.len(), 3, "the chain grew or shrank");
        assert_eq!(
            read_file(&backup_path(&path, "bak1")).expect("bak1"),
            "save 49"
        );
        assert_eq!(
            read_file(&backup_path(&path, "bak2")).expect("bak2"),
            "save 48"
        );
        assert_eq!(
            read_file(&backup_path(&path, "bak3")).expect("bak3"),
            "save 47"
        );

        // Nothing beyond the chain: a `bak4` would mean the rotation is
        // appending rather than rotating, and 50 saves would fill a USB stick.
        assert!(!backup_path(&path, "bak4").exists());
    }

    /// The tournament keeps its own path throughout. A rotation that *renamed*
    /// the current file would leave nothing at that path until the write
    /// finished, and a power cut in that window costs the host the file they
    /// know how to find.
    #[test]
    fn rotation_never_leaves_the_tournament_without_a_file() {
        let dir = TempDir::new("rotate-present");
        let path = dir.join("t.wattmatt");
        write_atomic(&path, "as it stood").expect("write");

        rotate_backups(&path);

        assert_eq!(read_file(&path).expect("read"), "as it stood");
    }

    #[test]
    fn rotating_before_the_first_save_creates_nothing() {
        let dir = TempDir::new("rotate-nothing");
        let path = dir.join("t.wattmatt");

        rotate_backups(&path);

        assert!(list_backups_of(&path).is_empty());
        assert!(!path.exists());
    }

    /// The command is what the frontend calls, and the acceptance criterion is
    /// about saves rather than about `rotate_backups` being called correctly by
    /// a test. `write_atomic` on its own deliberately does not rotate.
    #[test]
    fn the_write_command_rotates_and_the_bare_atomic_write_does_not() {
        let dir = TempDir::new("rotate-command");
        let path = dir.join("t.wattmatt");
        let as_string = path.to_string_lossy().into_owned();

        write_tournament(as_string.clone(), "first".to_string()).expect("first save");
        write_tournament(as_string, "second".to_string()).expect("second save");
        assert_eq!(
            read_file(&backup_path(&path, "bak1")).expect("bak1"),
            "first"
        );

        write_atomic(&path, "third").expect("bare write");
        assert_eq!(
            read_file(&backup_path(&path, "bak1")).expect("bak1"),
            "first",
            "write_atomic must not rotate"
        );
    }

    #[test]
    fn a_file_with_no_backups_reports_none() {
        let dir = TempDir::new("no-backups");
        let path = dir.join("t.wattmatt");
        write_atomic(&path, "{}").expect("write");

        assert!(list_backups_of(&path).is_empty());
    }

    #[test]
    fn the_extension_check_accepts_the_casing_windows_hands_back() {
        assert!(has_tournament_extension(Path::new("T.WATTMATT")));
        assert!(has_tournament_extension(Path::new("t.wattmatt")));
        assert!(!has_tournament_extension(Path::new("t.wattmatt.tmp")));
        assert!(!has_tournament_extension(Path::new("t.json")));
    }
}
