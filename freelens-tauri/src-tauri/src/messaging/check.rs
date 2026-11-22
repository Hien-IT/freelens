/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The check-only channels of `--messaging-check`
//! (`specs/002-messaging-for-tauri/contracts/check-log.md`). The Electron
//! build has none of them.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Deserialize;

use super::admin::Announcements;
use super::{Channels, DuplicateChannel, Log, MessageChannel, RequestChannel, View};

/// The rounds each view runs.
pub const ROUNDS: u32 = 20;

pub const REPORT: MessageChannel<Report> = MessageChannel::new("messaging-check:report");
pub const ECHO: RequestChannel<Echo, String> = RequestChannel::new("messaging-check:echo");

#[derive(Deserialize)]
pub struct Echo {
    text: String,
}

#[derive(Deserialize)]
pub struct StepFailure {
    step: String,
    message: String,
}

/// What a view reports.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Report {
    Version {
        version: String,
    },
    Round {
        round: u32,
        failed: Option<StepFailure>,
    },
    Echo {
        bytes: usize,
        ms: f64,
    },
    Done,
    /// A cluster frame's attempt to post to the main window's host.
    Isolation {
        blocked: bool,
    },
    /// What that attempt posts; it must never arrive.
    Intrusion,
}

#[derive(Default)]
struct Progress {
    announcements_seen: u64,
    passed: u32,
}

pub fn register(
    channels: &mut Channels,
    announcements: Announcements,
    log: Log,
) -> Result<(), DuplicateChannel> {
    channels.answer(ECHO, |echo: Echo, _| async move { Ok(echo.text) })?;

    let progress = Arc::new(Mutex::new(HashMap::<View, Progress>::new()));
    channels.listen(REPORT, move |report, view| {
        let mut progress = progress.lock().expect("the check lock");
        let progress = progress.entry(view.clone()).or_default();
        let line = match report {
            Report::Version { version } => format!("build version {version}"),
            Report::Round { round, failed } => {
                // The view announced itself before reporting, and a batch keeps
                // its order (research R5), so the count has grown by now.
                let count = announcements.count(&view);
                let grown = count > progress.announcements_seen;
                progress.announcements_seen = count;
                match failed {
                    Some(StepFailure { step, message }) => {
                        format!("round {round} failed at {step}: {message}")
                    }
                    None if !grown => {
                        format!("round {round} failed at message to core: no announcement arrived")
                    }
                    None => {
                        progress.passed += 1;
                        format!("round {round} passed")
                    }
                }
            }
            Report::Echo { bytes, ms } => format!("answer of {bytes} bytes in {ms:.1} ms"),
            Report::Done => format!("done, {} of {ROUNDS} rounds passed", progress.passed),
            Report::Isolation { blocked: true } => {
                "isolation: its post to the main window's host was blocked".to_string()
            }
            Report::Isolation { blocked: false } => {
                "isolation failed: its post to the main window's host was not blocked".to_string()
            }
            Report::Intrusion => {
                "isolation failed: received a message another view posted to its host".to_string()
            }
        };
        log(&format!("Messaging check: {view} {line}"));
    });

    Ok(())
}
