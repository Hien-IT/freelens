/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

pub mod catalog;
pub mod clusters;
pub mod messaging;
pub mod options;
pub mod scheme;
pub mod version;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

use messaging::{Channels, DuplicateChannel, Log, Messaging};

/// Registers the channels of every core area (`contracts/core-channels.md`).
pub fn register_channels(
    check: bool,
    version: String,
    log: &Log,
) -> Result<Messaging, DuplicateChannel> {
    let mut channels = Channels::with_log(Arc::clone(log));
    let announcements = messaging::admin::register(&mut channels, Arc::clone(log))?;
    version::register(&mut channels, version)?;
    if check {
        messaging::check::register(&mut channels, announcements, Arc::clone(log))?;
    }
    Ok(channels.build())
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
    let messaging = match register_channels(
        messaging_check,
        context.package_info().version.to_string(),
        &log,
    ) {
        Ok(messaging) => messaging,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let catalog = catalog::Catalog::load(&options.kubeconfig, home.as_deref());
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
