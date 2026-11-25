/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `validate-directory` and `path-exists`: what a path the user typed is,
//! never what it holds (`specs/007-main-foundation/contracts/foundation-channels.md`,
//! "Directories").

use std::fs;
use std::io;
use std::os::unix::fs::FileTypeExt;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::messaging::{Channels, DuplicateChannel, RequestChannel};

pub const VALIDATE: RequestChannel<String, Value> = RequestChannel::new("validate-directory");
pub const EXISTS: RequestChannel<String, bool> = RequestChannel::new("path-exists");

/// `resolveTilde`: only `~` and `~/` alone are the home directory.
pub fn resolve_tilde(path: &str, home: &Path) -> PathBuf {
    match path {
        "~" => home.to_path_buf(),
        "~/" => PathBuf::from(format!("{}/", home.display())),
        _ => PathBuf::from(path),
    }
}

/// `{ ok: true }` for a directory, its symbolic links followed; otherwise
/// `{ ok: false, error }` with the Electron build's text, and no `error` for
/// an error the Electron build has no text for.
pub fn validate(path: &Path) -> Value {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => json!({"ok": true}),
        Ok(metadata) => {
            let kind = metadata.file_type();
            let kind = if kind.is_file() {
                "a file"
            } else if kind.is_fifo() {
                "a pipe"
            } else if kind.is_socket() {
                "a socket"
            } else if kind.is_block_device() {
                "a block device"
            } else if kind.is_char_device() {
                "a character device"
            } else {
                "an unknown file type"
            };
            json!({"ok": false, "error": format!("the provided path is {kind} and not a directory.")})
        }
        Err(error) => match message_of(&error) {
            Some(message) => json!({"ok": false, "error": message}),
            None => json!({"ok": false}),
        },
    }
}

fn message_of(error: &io::Error) -> Option<&'static str> {
    Some(match error.raw_os_error()? {
        libc::ENOENT => "the provided path does not exist.",
        libc::EACCES => {
            "search permissions is denied for one of the directories in the prefix of the provided path."
        }
        libc::ELOOP => {
            "the provided path is a sym-link which points to a chain of sym-links that is too long to resolve. Perhaps it is cyclic."
        }
        libc::ENAMETOOLONG => "the pathname is too long to be used.",
        libc::ENOTDIR => "a prefix of the provided path is not a directory.",
        _ => return None,
    })
}

/// `pathExists`: whether the path, its symbolic links followed, exists; any
/// error reads as no.
pub fn exists(path: &Path) -> bool {
    path.try_exists().unwrap_or(false)
}

pub fn register(channels: &mut Channels, home: PathBuf) -> Result<(), DuplicateChannel> {
    let validating = home.clone();
    channels.answer(VALIDATE, move |path, _| {
        let path = resolve_tilde(&path, &validating);
        async move { Ok(validate(&path)) }
    })?;
    channels.answer(EXISTS, move |path, _| {
        let path = resolve_tilde(&path, &home);
        async move { Ok(exists(&path)) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_named_errno_has_the_electron_build_s_text() {
        for (code, text) in [
            (libc::ENOENT, "the provided path does not exist."),
            (
                libc::EACCES,
                "search permissions is denied for one of the directories in the prefix of the provided path.",
            ),
            (
                libc::ELOOP,
                "the provided path is a sym-link which points to a chain of sym-links that is too long to resolve. Perhaps it is cyclic.",
            ),
            (libc::ENAMETOOLONG, "the pathname is too long to be used."),
            (
                libc::ENOTDIR,
                "a prefix of the provided path is not a directory.",
            ),
        ] {
            assert_eq!(message_of(&io::Error::from_raw_os_error(code)), Some(text));
        }
    }

    #[test]
    fn another_errno_has_no_text() {
        assert_eq!(message_of(&io::Error::from_raw_os_error(libc::EPERM)), None);
        assert_eq!(message_of(&io::Error::other("no code")), None);
    }

    #[test]
    fn the_tilde_is_resolved_alone_only() {
        let home = Path::new("/Users/me");
        assert_eq!(resolve_tilde("~", home), PathBuf::from("/Users/me"));
        assert_eq!(resolve_tilde("~/", home).to_string_lossy(), "/Users/me/");
        assert_eq!(resolve_tilde("~/foo", home), PathBuf::from("~/foo"));
        assert_eq!(resolve_tilde("/tmp", home), PathBuf::from("/tmp"));
    }
}
