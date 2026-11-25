/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The check-only channels of `--frames-check`
//! (`specs/004-cluster-frames/contracts/frames-log.md`). The Electron build
//! has none of them.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Deserialize;

use crate::frames::Frames;
use crate::messaging::{Channels, DuplicateChannel, Log, MessageChannel, RequestChannel, View};

pub const REPORT: MessageChannel<Report> = MessageChannel::new("frames-check:report");
pub const SEND_TO: RequestChannel<SendTo, bool> = RequestChannel::new("frames-check:send-to");
pub const SEND_TO_VISIBLE: RequestChannel<SendToVisible, bool> =
    RequestChannel::new("frames-check:send-to-visible");
pub const PING: MessageChannel<String> = MessageChannel::new("frames-check:ping");

#[derive(Deserialize)]
pub struct SendTo {
    cluster: String,
    token: String,
}

#[derive(Deserialize)]
pub struct SendToVisible {
    token: String,
}

/// What a view reports.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Report {
    NotRun {
        clusters: usize,
    },
    Origin {
        origin: String,
    },
    Blocked {
        attempt: String,
    },
    Failed {
        attempt: String,
    },
    Sent {
        attempt: String,
    },
    /// The page-state mark the view holds in memory, and its own mark in
    /// local storage.
    Marks {
        state: Option<String>,
        storage: Option<String>,
    },
    Ping {
        token: String,
    },
    Done,
}

type Marks = (Option<String>, Option<String>);

/// `kept` when the mark equals the one the view reported before, `new` when
/// it does not, `missing` when there is none.
fn compare(before: Option<&Option<String>>, now: &Option<String>) -> &'static str {
    match now {
        None => "missing",
        Some(_) if before == Some(now) => "kept",
        Some(_) => "new",
    }
}

pub fn register(channels: &mut Channels, frames: Frames, log: Log) -> Result<(), DuplicateChannel> {
    let reported = Arc::new(Mutex::new(HashMap::<View, Marks>::new()));
    let printing = Arc::clone(&log);
    channels.listen(REPORT, move |report, view| {
        let line = match report {
            Report::NotRun { clusters } => {
                format!("not run: the catalog has {clusters} clusters, three are needed")
            }
            Report::Origin { origin } => format!("{view} origin {origin}"),
            Report::Blocked { attempt } => format!("{view} blocked {attempt}"),
            Report::Failed { attempt } => format!("{view} isolation failed: {attempt}"),
            Report::Sent { attempt } => format!("{view} sent {attempt}"),
            Report::Marks { state, storage } => {
                let mut reported = reported.lock().expect("the marks lock");
                let before = reported.get(&view);
                let line = format!(
                    "{view} marks {} {}",
                    compare(before.map(|marks| &marks.0), &state),
                    compare(before.map(|marks| &marks.1), &storage)
                );
                reported.insert(view.clone(), (state, storage));
                line
            }
            Report::Ping { token } => format!("{view} received ping {token}"),
            Report::Done => "done".to_string(),
        };
        printing(&format!("Frames check: {line}"));
    });

    let sending = frames.clone();
    let sent = Arc::clone(&log);
    channels.answer(SEND_TO, move |SendTo { cluster, token }, _| {
        let (frames, log) = (sending.clone(), Arc::clone(&sent));
        async move {
            let had_frame = frames.has_frame(&cluster);
            frames.send_to(&cluster, PING, &token);
            log(&format!(
                "Frames check: send-to cluster {cluster} token {token}: {had_frame}"
            ));
            Ok(had_frame)
        }
    })?;

    channels.answer(SEND_TO_VISIBLE, move |SendToVisible { token }, _| {
        let (frames, log) = (frames.clone(), Arc::clone(&log));
        async move {
            let had_frame = frames.visible().is_some_and(|id| frames.has_frame(&id));
            frames.send_to_visible(PING, &token);
            log(&format!(
                "Frames check: send-to-visible token {token}: {had_frame}"
            ));
            Ok(had_frame)
        }
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::compare;

    #[test]
    fn a_mark_is_kept_new_or_missing() {
        let mark = Some("a".to_string());
        assert_eq!(compare(None, &mark), "new");
        assert_eq!(compare(Some(&None), &mark), "new");
        assert_eq!(compare(Some(&Some("b".to_string())), &mark), "new");
        assert_eq!(compare(Some(&mark), &mark), "kept");
        assert_eq!(compare(Some(&mark), &None), "missing");
        assert_eq!(compare(None, &None), "missing");
    }
}
