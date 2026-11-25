/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The sync box channels: no sync box exists, so the core answers an empty
//! list and drops what it hears, as the Electron build's main side does.

use serde_json::Value;

use crate::messaging::{Channels, DuplicateChannel, MessageChannel, RequestChannel};

pub const INITIAL: RequestChannel<(), Vec<Value>> =
    RequestChannel::new("sync-box-initial-value-channel");
pub const SYNC: MessageChannel<Value> = MessageChannel::new("sync-box-channel");

pub fn register(channels: &mut Channels) -> Result<(), DuplicateChannel> {
    channels.answer(INITIAL, |(), _| async { Ok(Vec::new()) })?;
    channels.listen(SYNC, |_, _| {});
    Ok(())
}
