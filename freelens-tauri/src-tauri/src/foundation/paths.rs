/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The data directory and the paths of the application, as the Electron build
//! computes them (`specs/007-main-foundation/research.md`, R6).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Whether the core was built for release or for development, which decides
/// the application's name as `NODE_ENV` decides it in the Electron build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildKind {
    Release,
    Debug,
}

impl BuildKind {
    /// The kind of this build of the core.
    pub fn current() -> Self {
        if cfg!(debug_assertions) {
            Self::Debug
        } else {
            Self::Release
        }
    }

    /// `appName` of the Electron build: the product name, plus `Dev` in a
    /// development build.
    pub fn app_name(self) -> &'static str {
        match self {
            Self::Release => "Freelens",
            Self::Debug => "FreelensDev",
        }
    }
}

/// The home directory of the user database, as Node's `os.userInfo().homedir`
/// reads it for the Electron build, rather than `$HOME`.
pub fn user_home() -> PathBuf {
    // SAFETY: `passwd` is plain data that getpwuid_r fills in; the buffer it
    // points into outlives every read of it below.
    unsafe {
        let mut entry: libc::passwd = std::mem::zeroed();
        let mut buffer = vec![0 as libc::c_char; 16 * 1024];
        let mut found = std::ptr::null_mut();
        let status = libc::getpwuid_r(
            libc::getuid(),
            &mut entry,
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        );
        if status == 0 && !found.is_null() && !entry.pw_dir.is_null() {
            let home = std::ffi::CStr::from_ptr(entry.pw_dir);
            return PathBuf::from(home.to_string_lossy().into_owned());
        }
    }
    std::env::home_dir().unwrap_or_default()
}

/// The directory both builds keep their files in: `--data-dir` when given;
/// else `<FREELENS_INTEGRATION_TESTING_DIR>/<app name>` when that variable is
/// set, wherever it points, as the Electron build's `userData` follows it;
/// else the application support directory of the user.
pub fn data_dir(
    option: Option<&Path>,
    integration_testing_dir: Option<&OsStr>,
    home: &Path,
    build: BuildKind,
) -> PathBuf {
    if let Some(path) = option {
        return path.to_path_buf();
    }
    match integration_testing_dir {
        Some(dir) if !dir.is_empty() => Path::new(dir).join(build.app_name()),
        _ => home
            .join("Library")
            .join("Application Support")
            .join(build.app_name()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/me";

    #[test]
    fn the_option_wins() {
        assert_eq!(
            data_dir(
                Some(Path::new("/tmp/data")),
                Some(OsStr::new("/tmp/it")),
                Path::new(HOME),
                BuildKind::Release
            ),
            PathBuf::from("/tmp/data")
        );
    }

    #[test]
    fn the_integration_testing_directory_holds_the_app_name() {
        for dir in ["/var/folders/x/T/it", "/somewhere/else"] {
            assert_eq!(
                data_dir(
                    None,
                    Some(OsStr::new(dir)),
                    Path::new(HOME),
                    BuildKind::Release
                ),
                Path::new(dir).join("Freelens"),
                "for {dir}"
            );
        }
        assert_eq!(
            data_dir(
                None,
                Some(OsStr::new("/it")),
                Path::new(HOME),
                BuildKind::Debug
            ),
            PathBuf::from("/it/FreelensDev")
        );
    }

    #[test]
    fn an_empty_integration_testing_directory_is_ignored() {
        assert_eq!(
            data_dir(
                None,
                Some(OsStr::new("")),
                Path::new(HOME),
                BuildKind::Release
            ),
            PathBuf::from("/Users/me/Library/Application Support/Freelens")
        );
    }

    #[test]
    fn the_default_is_the_application_support_directory() {
        assert_eq!(
            data_dir(None, None, Path::new(HOME), BuildKind::Release),
            PathBuf::from("/Users/me/Library/Application Support/Freelens")
        );
        assert_eq!(
            data_dir(None, None, Path::new(HOME), BuildKind::Debug),
            PathBuf::from("/Users/me/Library/Application Support/FreelensDev")
        );
    }
}
