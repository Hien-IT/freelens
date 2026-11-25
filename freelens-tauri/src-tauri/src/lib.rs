/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

pub mod catalog;
pub mod clusters;
pub mod frames;
pub mod messaging;
pub mod options;
pub mod scheme;
pub mod version;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

use catalog::Catalog;
use frames::Frames;
use messaging::{Channels, DuplicateChannel, Log, Messaging};

/// What startup builds for the areas of the core to share.
pub struct Core {
    pub messaging: Messaging,
    pub frames: Frames,
}

/// Registers the channels of every core area (`contracts/core-channels.md`)
/// and builds the frame record over the clusters of `catalog`.
pub fn register_core(
    check: bool,
    version: String,
    catalog: &Catalog,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    let ids = catalog
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    build(check, version, ids, log)
}

/// The channels alone, with no catalog behind the frame record, so that no
/// cluster can be named visible; for callers that need only `Messaging`.
pub fn register_channels(
    check: bool,
    version: String,
    log: &Log,
) -> Result<Messaging, DuplicateChannel> {
    build(check, version, HashSet::new(), log).map(|core| core.messaging)
}

fn build(
    check: bool,
    version: String,
    catalog: HashSet<String>,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    let mut channels = Channels::with_log(Arc::clone(log));
    let announcements = messaging::admin::register(&mut channels, Arc::clone(log))?;
    version::register(&mut channels, version)?;
    let frames = frames::register(&mut channels, catalog, Arc::clone(log))?;
    if check {
        messaging::check::register(&mut channels, announcements, Arc::clone(log))?;
    }
    Ok(Core {
        messaging: channels.build(),
        frames,
    })
}

pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let options = match options::parse(std::env::args().skip(1), &cwd) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let context = tauri::generate_context!();
    let log: Log = Arc::new(|line| println!("{line}"));
    let messaging_check = options.messaging_check;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let catalog = Catalog::load(&options.kubeconfig, home.as_deref());
    let Core { messaging, .. } = match register_core(
        messaging_check,
        context.package_info().version.to_string(),
        &catalog,
        &log,
    ) {
        Ok(core) => core,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    // Closes the queues of the views that are gone without waiting for a
    // poll or a send, so that the frame record forgets a closed frame within
    // a second of its queue closing (research R5 of spec 004).
    let sweeping = messaging.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tick.tick().await;
            sweeping.sweep();
        }
    });
    let clusters = clusters::KubeClusters::new(catalog.kubeconfig().cloned());
    let state = Arc::new(scheme::State {
        catalog,
        clusters: Box::new(clusters),
        open_cluster: options.open_cluster,
        log: Box::new(|line| println!("{line}")),
    });
    let loaded = AtomicBool::new(false);

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            scheme::SCHEME,
            move |context, request, responder| {
                let app = context.app_handle().clone();
                let state = Arc::clone(&state);
                let messaging = messaging.clone();
                tauri::async_runtime::spawn(async move {
                    // The routes of messaging, contracts/ipc-routes.md of spec 002.
                    if request.uri().path().starts_with("/ipc/") {
                        let response =
                            messaging::routes::handle(request, &state.catalog, &messaging).await;
                        responder.respond(response);
                        return;
                    }
                    let resolver = app.asset_resolver();
                    let assets = |path: &str| {
                        resolver.get(path.to_string()).map(|asset| scheme::Asset {
                            bytes: asset.bytes,
                            mime: asset.mime_type,
                        })
                    };
                    responder.respond(scheme::handle(request, &state, &assets).await);
                });
            },
        )
        .on_page_load(move |webview, payload| {
            if webview.label() == "main"
                && payload.event() == PageLoadEvent::Finished
                && !loaded.swap(true, Ordering::SeqCst)
            {
                println!("Window \"main\" loaded");
            }
        })
        .setup(move |app| {
            let query = if messaging_check {
                "?messaging-check"
            } else {
                ""
            };
            let url = format!("{}://{}/{query}", scheme::SCHEME, scheme::MAIN_HOST).parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("Freelens Spike")
                .inner_size(1200.0, 800.0)
                // A non-persistent website data store: no run leaves data behind.
                .incognito(true)
                .build()?;
            Ok(())
        })
        .run(context)
        .expect("error while running the application");
}
