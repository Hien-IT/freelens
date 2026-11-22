/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `build-version`, answered as the Electron build answers it with
//! `app.getVersion()` (`packages/core/src/features/vars/build-version/`).

use crate::messaging::{Channels, DuplicateChannel, RequestChannel};

pub const BUILD_VERSION: RequestChannel<(), String> = RequestChannel::new("build-version");

pub fn register(channels: &mut Channels, version: String) -> Result<(), DuplicateChannel> {
    channels.answer(BUILD_VERSION, move |(), _| {
        let version = version.clone();
        async move { Ok(version) }
    })
}
