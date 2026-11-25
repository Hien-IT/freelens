/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! One build per data directory (`specs/007-main-foundation/contracts/instance-lock.md`,
//! research R5): the Tauri build holds `FreelensTauriLock`, and stays out of a
//! data directory whose `SingletonLock`, Chromium's lock in every Electron
//! build, or whose `FreelensTauriLock` names a process that is alive.

use std::fmt;
use std::fs;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use crate::messaging::Log;

/// The link the Tauri build holds, in Chromium's format.
pub const TAURI_LINK: &str = "FreelensTauriLock";
/// The link Chromium holds for every Electron build.
pub const ELECTRON_LINK: &str = "SingletonLock";

/// The build that holds a data directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Build {
    Electron,
    Tauri,
}

impl fmt::Display for Build {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Electron => "Electron",
            Self::Tauri => "Tauri",
        })
    }
}

/// Why the Tauri build does not start: another build runs on the data directory.
#[derive(Debug)]
pub struct Refusal {
    pub build: Build,
    pub data_dir: PathBuf,
    pub link: PathBuf,
    pub target: String,
}

impl Refusal {
    pub fn log_line(&self) -> String {
        format!(
            "error: Instance: {} build runs on {} ({} -> {})",
            self.build,
            self.data_dir.display(),
            self.link.display(),
            self.target
        )
    }

    pub fn message(&self) -> &'static str {
        "Freelens is already running"
    }

    pub fn informative_text(&self) -> String {
        format!(
            "The {} build of Freelens is using {}. Quit it, then start this one again. If it is not running, delete {}.",
            self.build,
            self.data_dir.display(),
            self.link.display()
        )
    }

    /// Shows the refusal in a native alert and waits for the user to close it.
    /// `NSAlert` returns at once when run before Tauri has set the application
    /// up, so the alert is `osascript`'s, with the texts passed as arguments
    /// rather than written into the script.
    pub fn show_alert(&self) {
        let shown = std::process::Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "display alert (item 1 of argv) message (item 2 of argv) as critical",
                "-e",
                "end run",
            ])
            .arg(self.message())
            .arg(self.informative_text())
            .stdout(std::process::Stdio::null())
            .status();
        if let Err(error) = shown {
            eprintln!("error: Instance: cannot show the alert: {error}");
        }
    }
}

/// The Tauri build's hold on a data directory; the link goes when it drops.
#[derive(Debug)]
pub struct InstanceLock {
    link: Option<PathBuf>,
    target: String,
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        let Some(link) = &self.link else {
            return;
        };
        let still_own = fs::read_link(link)
            .map(|target| target.as_os_str() == self.target.as_str())
            .unwrap_or(false);
        if still_own {
            let _ = fs::remove_file(link);
        }
    }
}

/// Takes the data directory for this process, or says which build holds it.
/// Logs, and goes on without a link, when the link cannot be written for a
/// reason other than another build.
pub fn acquire(data_dir: &Path, log: &Log) -> Result<InstanceLock, Refusal> {
    if let Err(error) = fs::create_dir_all(data_dir) {
        log(&format!(
            "error: Instance: cannot create {}: {error}",
            data_dir.display()
        ));
    }
    let tauri_link = data_dir.join(TAURI_LINK);
    let target = format!("{}-{}", this_host(), std::process::id());
    let mut held = None;
    for attempt in 0..2 {
        match symlink(&target, &tauri_link) {
            Ok(()) => {
                held = Some(tauri_link.clone());
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let existing = read_target(&tauri_link);
                if attempt == 1 || existing.as_deref().is_some_and(is_live) {
                    return Err(refuse(log, Build::Tauri, data_dir, &tauri_link, existing));
                }
                let _ = fs::remove_file(&tauri_link);
            }
            Err(error) => {
                log(&format!(
                    "error: Instance: cannot write {}: {error}",
                    tauri_link.display()
                ));
                break;
            }
        }
    }
    let lock = InstanceLock { link: held, target };
    let electron_link = data_dir.join(ELECTRON_LINK);
    if let Some(existing) = read_target(&electron_link).filter(|target| is_live(target)) {
        // Dropping the lock removes the link just made.
        drop(lock);
        return Err(refuse(
            log,
            Build::Electron,
            data_dir,
            &electron_link,
            Some(existing),
        ));
    }
    Ok(lock)
}

fn refuse(
    log: &Log,
    build: Build,
    data_dir: &Path,
    link: &Path,
    target: Option<String>,
) -> Refusal {
    let refusal = Refusal {
        build,
        data_dir: data_dir.to_path_buf(),
        link: link.to_path_buf(),
        target: target.unwrap_or_default(),
    };
    log(&refusal.log_line());
    refusal
}

fn read_target(link: &Path) -> Option<String> {
    fs::read_link(link)
        .ok()
        .map(|target| target.to_string_lossy().into_owned())
}

/// The host name Chromium writes into `SingletonLock`.
pub fn this_host() -> String {
    let mut buffer = [0u8; 256];
    // SAFETY: the buffer is writable for its whole length, and gethostname
    // writes at most that many bytes.
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return String::new();
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).into_owned()
}

/// Whether a `<hostname>-<pid>` target names a process that may be running: one
/// of another host, as Chromium assumes, or one `kill(pid, 0)` finds. A target
/// that does not parse is not live.
fn is_live(target: &str) -> bool {
    let Some((host, pid)) = target.rsplit_once('-') else {
        return false;
    };
    let Ok(pid) = pid.parse::<libc::pid_t>() else {
        return false;
    };
    if pid <= 0 || host.is_empty() {
        return false;
    }
    if host != this_host() {
        return true;
    }
    // SAFETY: signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
