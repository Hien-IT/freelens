/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The channels of main-foundation besides the stores
//! (`specs/007-main-foundation/contracts/foundation-channels.md`).

pub mod directories;
pub mod download;
pub mod local_storage;
pub mod log_file;
pub mod paths;
pub mod sync_box;
pub mod templates;

use std::collections::HashSet;
use std::time::Duration;

use crate::messaging::{Channels, DuplicateChannel, Log, RequestChannel};
use crate::stores::Stores;
use paths::{Environment, MachineValues};

pub const APP_PATHS: RequestChannel<(), serde_json::Map<String, serde_json::Value>> =
    RequestChannel::new("app-paths");
pub const MACHINE_VALUES: RequestChannel<(), MachineValues> = RequestChannel::new("machine-values");

/// What the channels of main-foundation answer from.
pub struct Setup {
    pub env: Environment,
    /// The clusters of the catalog, whose local storage files may be used.
    pub clusters: HashSet<String>,
    pub stores: Stores,
    /// How often the templates folder is looked at.
    pub templates_interval: Duration,
    pub trust: download::Trust,
    pub log: Log,
}

impl Setup {
    /// The setup of this process, for the data directory of `stores`.
    pub fn current(stores: &Stores, clusters: HashSet<String>, log: Log) -> Self {
        Self {
            env: Environment::current(stores.data_dir()),
            clusters,
            stores: stores.clone(),
            templates_interval: Duration::from_secs(1),
            trust: download::Trust::Platform,
            log,
        }
    }
}

pub fn register(channels: &mut Channels, setup: Setup) -> Result<(), DuplicateChannel> {
    let app_paths = paths::app_paths(&setup.env);
    let machine_values = paths::machine_values(&setup.env);
    let home = setup.env.home_directory();
    channels.answer(APP_PATHS, move |(), _| {
        let app_paths = app_paths.clone();
        async move { Ok(app_paths) }
    })?;
    channels.answer(MACHINE_VALUES, move |(), _| {
        let machine_values = machine_values.clone();
        async move { Ok(machine_values) }
    })?;
    local_storage::register(channels, &setup.env.data_dir, setup.clusters)?;
    directories::register(channels, home.clone())?;
    templates::register(channels, &home, setup.templates_interval, setup.log)?;
    download::register(channels, setup.stores, setup.trust)?;
    sync_box::register(channels)
}
