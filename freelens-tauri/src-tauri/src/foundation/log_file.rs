/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The core's log file, next to the Electron build's `lens.log` and with its
//! rotation: `freelens-tauri.log` is the newest, `freelens-tauri1.log` to
//! `freelens-tauri15.log` the older ones (research R10).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The rotation of the Electron build's file transport: 1 MiB, 16 files.
pub const MAX_SIZE: u64 = 1024 * 1024;
pub const MAX_FILES: usize = 16;
const BASE: &str = "freelens-tauri";

pub struct LogFile {
    directory: PathBuf,
    max_size: u64,
    open: Mutex<Option<(File, u64)>>,
}

impl LogFile {
    pub fn new(directory: &Path) -> Self {
        Self::with_size(directory, MAX_SIZE)
    }

    /// For the tests: a smaller size to rotate at.
    pub fn with_size(directory: &Path, max_size: u64) -> Self {
        Self {
            directory: directory.to_path_buf(),
            max_size,
            open: Mutex::new(None),
        }
    }

    fn path(&self, index: usize) -> PathBuf {
        let name = if index == 0 {
            format!("{BASE}.log")
        } else {
            format!("{BASE}{index}.log")
        };
        self.directory.join(name)
    }

    /// `<level>: <message>`: a line that already starts with `error: ` or
    /// `warn: ` keeps it, any other is `info`.
    pub fn format(line: &str) -> String {
        if line.starts_with("error: ") || line.starts_with("warn: ") {
            format!("{line}\n")
        } else {
            format!("info: {line}\n")
        }
    }

    /// Appends one line, rotating first when it would go over the size. A log
    /// that cannot be written is skipped: the line still reaches standard
    /// output through the caller.
    pub fn write(&self, line: &str) {
        let text = Self::format(line);
        let mut open = self.open.lock().expect("log lock");
        let size = match open.as_ref() {
            Some((_, size)) => *size,
            None => fs::metadata(self.path(0))
                .map(|meta| meta.len())
                .unwrap_or(0),
        };
        if size > 0 && size + text.len() as u64 > self.max_size {
            *open = None;
            self.rotate();
        }
        if open.is_none() {
            let _ = fs::create_dir_all(&self.directory);
            *open = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.path(0))
                .ok()
                .map(|file| {
                    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
                    (file, size)
                });
        }
        if let Some((file, size)) = open.as_mut()
            && file.write_all(text.as_bytes()).is_ok()
        {
            *size += text.len() as u64;
        }
    }

    /// `tailable`: every file moves one up, the oldest beyond the count goes.
    fn rotate(&self) {
        let _ = fs::remove_file(self.path(MAX_FILES - 1));
        for index in (0..MAX_FILES - 1).rev() {
            let _ = fs::rename(self.path(index), self.path(index + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_dir() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "freelens-log-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_line_is_its_level_and_its_message() {
        assert_eq!(
            LogFile::format("Messaging: main announced"),
            "info: Messaging: main announced\n"
        );
        assert_eq!(LogFile::format("error: Stores: x"), "error: Stores: x\n");
        assert_eq!(
            LogFile::format("warn: Templates: y"),
            "warn: Templates: y\n"
        );
        assert_eq!(LogFile::format("errors: z"), "info: errors: z\n");
    }

    #[test]
    fn lines_are_appended_to_the_newest_file() {
        let dir = temp_dir();
        let log = LogFile::new(&dir.join("Logs"));
        log.write("one");
        log.write("error: two");
        assert_eq!(
            fs::read_to_string(dir.join("Logs/freelens-tauri.log")).unwrap(),
            "info: one\nerror: two\n"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_files_rotate_with_the_newest_always_under_the_base_name() {
        let dir = temp_dir();
        // Each line is "info: line NN\n", 14 bytes: two fit in 30 bytes.
        let log = LogFile::with_size(&dir, 30);
        for index in 0..40 {
            log.write(&format!("line {index:02}"));
        }
        let read = |name: &str| fs::read_to_string(dir.join(name)).unwrap();
        assert_eq!(read("freelens-tauri.log"), "info: line 38\ninfo: line 39\n");
        assert_eq!(
            read("freelens-tauri1.log"),
            "info: line 36\ninfo: line 37\n"
        );
        assert_eq!(
            read("freelens-tauri15.log"),
            "info: line 08\ninfo: line 09\n"
        );
        assert!(!dir.join("freelens-tauri16.log").exists());
        let files = fs::read_dir(&dir).unwrap().count();
        assert_eq!(files, MAX_FILES);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_log_that_cannot_be_written_is_skipped() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let log = LogFile::new(&dir.join("Logs"));
        log.write("lost");
        assert!(!dir.join("Logs").exists());
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        let _ = fs::remove_dir_all(dir);
    }
}
