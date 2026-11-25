/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

pub mod catalog;
pub mod clusters;
pub mod frames;
pub mod frames_check;
pub mod messaging;
pub mod options;
pub mod routes;
pub mod scheme;
pub mod version;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use http::Method;
use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

use catalog::Catalog;
use frames::Frames;
use messaging::{Channels, DuplicateChannel, Log, Messaging};
use routes::{Audience, Env};

/// What startup builds for the areas of the core to share.
pub struct Core {
    pub messaging: Messaging,
    pub frames: Frames,
}

/// The check runs whose channels the core registers.
#[derive(Debug, Clone, Copy, Default)]
pub struct Checks {
    /// `--messaging-check` of spec 002.
    pub messaging: bool,
    /// `--frames-check` of spec 004.
    pub frames: bool,
}

/// Registers the channels of every core area (`contracts/core-channels.md`)
/// and builds the frame record over the clusters of `catalog`.
pub fn register_core(
    checks: Checks,
    version: String,
    catalog: &Catalog,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    let ids = catalog
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    build(checks, version, ids, log)
}

/// The channels alone, with no catalog behind the frame record, so that no
/// cluster can be named visible; for callers that need only `Messaging`.
pub fn register_channels(
    check: bool,
    version: String,
    log: &Log,
) -> Result<Messaging, DuplicateChannel> {
    let checks = Checks {
        messaging: check,
        frames: false,
    };
    build(checks, version, HashSet::new(), log).map(|core| core.messaging)
}

fn build(
    checks: Checks,
    version: String,
    catalog: HashSet<String>,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    let mut channels = Channels::with_log(Arc::clone(log));
    let announcements = messaging::admin::register(&mut channels, Arc::clone(log))?;
    version::register(&mut channels, version)?;
    let frames = frames::register(&mut channels, catalog, Arc::clone(log))?;
    if checks.messaging {
        messaging::check::register(&mut channels, announcements, Arc::clone(log))?;
    }
    if checks.frames {
        frames_check::register(&mut channels, frames.clone(), Arc::clone(log))?;
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
    let checks = Checks {
        messaging: options.messaging_check,
        frames: options.frames_check,
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let catalog = Catalog::load(&options.kubeconfig, home.as_deref());
    let Core { messaging, .. } = match register_core(
        checks,
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

    // Every request of the scheme goes through one table
    // (specs/004-cluster-frames/contracts/routes.md).
    let mut routes = scheme::routes();
    // The routes of messaging, contracts/ipc-routes.md of spec 002.
    let added = routes.add(
        Method::POST,
        "/ipc/",
        Audience::Both,
        move |request, _, env| {
            let messaging = messaging.clone();
            Box::pin(async move {
                messaging::routes::handle(request, &env.state.catalog, &messaging).await
            })
        },
    );
    if let Err(error) = added {
        eprintln!("{error}");
        std::process::exit(1);
    }
    if checks.frames {
        routes.log_cookies(Arc::clone(&log));
    }
    let routes = Arc::new(routes);
    let navigating = Arc::clone(&state);

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            scheme::SCHEME,
            move |context, request, responder| {
                let app = context.app_handle().clone();
                let state = Arc::clone(&state);
                let routes = Arc::clone(&routes);
                tauri::async_runtime::spawn(async move {
                    let resolver = app.asset_resolver();
                    let assets = |path: &str| {
                        resolver.get(path.to_string()).map(|asset| scheme::Asset {
                            bytes: asset.bytes,
                            mime: asset.mime_type,
                        })
                    };
                    let env = Env {
                        state: &state,
                        assets: &assets,
                    };
                    responder.respond(routes.handle(request, env).await);
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
            let runs: Vec<&str> = [
                (checks.messaging, "messaging-check"),
                (checks.frames, "frames-check"),
            ]
            .into_iter()
            .filter_map(|(on, name)| on.then_some(name))
            .collect();
            let query = if runs.is_empty() {
                String::new()
            } else {
                format!("?{}", runs.join("&"))
            };
            let url = format!("{}://{}/{query}", scheme::SCHEME, scheme::MAIN_HOST).parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("Freelens Spike")
                .inner_size(1200.0, 800.0)
                // A non-persistent website data store: no run leaves data behind.
                .incognito(true)
                // The main window stays on the scheme, whatever a frame tries
                // (FR-024, research R12). No `on_new_window`: by default
                // nothing opens.
                .on_navigation(move |url| {
                    let allowed = routes::allows_navigation(url, &navigating.catalog);
                    if !allowed {
                        println!(
                            "Frames: refused a navigation of the main window to {}",
                            url.scheme()
                        );
                    }
                    allowed
                })
                .build()?;
            Ok(())
        })
        .run(context)
        .expect("error while running the application");
}
