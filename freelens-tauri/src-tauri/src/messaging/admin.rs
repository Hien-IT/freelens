/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Messaging's own channels (research R7): the views' announcements and the
//! relay of their broadcasts.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::{ChannelError, Channels, DuplicateChannel, Log, MessageChannel, RequestChannel, View};

/// `frameCommunicationAdminChannel` of `messaging-for-renderer` and `messaging-for-tauri`.
pub const FRAME_COMMUNICATION_ADMIN: MessageChannel<()> =
    MessageChannel::new("frame-communication-admin-channel");

/// `broadcastToViewsChannel` of `packages/core/src/common/ipc/`: a view
/// broadcasting `{ channel, message }` to every view.
pub const BROADCAST_TO_VIEWS: RequestChannel<Value, ()> = RequestChannel::new("broadcast-to-views");

/// How many times each view has announced itself.
#[derive(Clone, Default)]
pub struct Announcements {
    counts: Arc<Mutex<HashMap<View, u64>>>,
}

impl Announcements {
    pub fn count(&self, view: &View) -> u64 {
        self.counts
            .lock()
            .expect("the announcements lock")
            .get(view)
            .copied()
            .unwrap_or_default()
    }
}

pub fn register(channels: &mut Channels, log: Log) -> Result<Announcements, DuplicateChannel> {
    let announcements = Announcements::default();
    let counts = announcements.clone();
    channels.listen(FRAME_COMMUNICATION_ADMIN, move |(), view| {
        *counts
            .counts
            .lock()
            .expect("the announcements lock")
            .entry(view.clone())
            .or_default() += 1;
        log(&format!("Messaging: {view} announced"));
    });

    let sender = channels.sender();
    channels.answer(BROADCAST_TO_VIEWS, move |request: Value, _| {
        let sender = sender.clone();
        async move {
            let channel = request
                .get("channel")
                .and_then(Value::as_str)
                .ok_or_else(|| ChannelError::from("the broadcast names no channel"))?;
            // An absent message stays absent, and null stays null.
            sender.send_raw(channel, request.get("message").cloned());
            Ok(())
        }
    })?;

    Ok(announcements)
}
