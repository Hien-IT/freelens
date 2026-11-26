/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

pub mod catalog;
pub mod cluster;
pub mod foundation;
pub mod frames;
pub mod frames_check;
pub mod instance;
pub mod messaging;
pub mod options;
pub mod routes;
pub mod scheme;
pub mod stores;
pub mod version;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use http::Method;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

use catalog::Catalog;
use frames::Frames;
use messaging::{Channels, DuplicateChannel, Log, Messaging};
use routes::{Audience, Env};
use stores::{Machine, Stores};

/// What startup builds for the areas of the core to share.
pub struct Core {
    pub messaging: Messaging,
    pub frames: Frames,
    pub stores: Stores,
    pub catalog: Catalog,
    pub clusters: cluster::Clusters,
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
/// and builds the frame record over the clusters of `catalog`, with `stores`
/// behind the channels of the stores.
pub fn register_core(
    checks: Checks,
    version: String,
    catalog: &Catalog,
    stores: &Stores,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    build(checks, version, catalog.clone(), stores, log)
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
    let stores = Stores::in_memory(Machine::current(), Arc::clone(log));
    build(checks, version, Catalog::empty(), &stores, log).map(|core| core.messaging)
}

fn build(
    checks: Checks,
    version: String,
    catalog: Catalog,
    stores: &Stores,
    log: &Log,
) -> Result<Core, DuplicateChannel> {
    let mut channels = Channels::with_log(Arc::clone(log));
    stores::register(&mut channels, stores)?;
    foundation::register(
        &mut channels,
        foundation::Setup::current(stores, catalog.clone(), Arc::clone(log)),
    )?;
    let announcements = messaging::admin::register(&mut channels, Arc::clone(log))?;
    version::register(&mut channels, version)?;
    let frames = frames::register(&mut channels, catalog.clone(), Arc::clone(log))?;
    catalog::channels::register(
        &mut channels,
        &catalog,
        &frames,
        catalog
            .log()
            .unwrap_or_else(|| catalog::CatalogLog::new(Arc::clone(log), false)),
    )?;
    let clusters = cluster::Clusters::new(&catalog);
    cluster::watch::register(&mut channels, &clusters, &frames, &catalog)?;
    if checks.messaging {
        messaging::check::register(&mut channels, announcements, Arc::clone(log))?;
    }
    if checks.frames {
        frames_check::register(&mut channels, frames.clone(), Arc::clone(log))?;
    }
    Ok(Core {
        messaging: channels.build(),
        frames,
        stores: stores.clone(),
        catalog,
        clusters,
    })
}

pub fn run() {
    foundation::app_nap::opt_out();
    let cwd = std::env::current_dir().unwrap_or_default();
    let options = match options::parse(std::env::args().skip(1), &cwd) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    // Every line goes to standard output, which the checks read, and to the
    // log file next to the Electron build's (research R10). The log comes
    // first, so that a refusal of the lock is in the file too.
    let log_file = Arc::new(foundation::log_file::LogFile::new(
        &foundation::paths::logs_dir(&foundation::paths::user_home()),
    ));
    let log: Log = Arc::new(move |line| {
        println!("{line}");
        log_file.write(line);
    });
    // Nothing of the data directory is read or written before the lock is
    // held (specs/007-main-foundation/contracts/instance-lock.md).
    let data_dir = foundation::paths::data_dir(
        options.data_dir.as_deref(),
        std::env::var_os("FREELENS_INTEGRATION_TESTING_DIR").as_deref(),
        &std::env::home_dir().unwrap_or_default(),
        foundation::paths::BuildKind::current(),
    );
    let instance_lock = match instance::acquire(&data_dir, &log) {
        Ok(lock) => std::sync::Mutex::new(Some(lock)),
        Err(refusal) => {
            refusal.show_alert();
            std::process::exit(1);
        }
    };
    let context = tauri::generate_context!();
    let checks = Checks {
        messaging: options.messaging_check,
        frames: options.frames_check,
    };
    let stores = Stores::load(&data_dir, Machine::current(), Arc::clone(&log));
    // Debug lines follow the debugging flag of `machine-values`.
    let debugging =
        foundation::paths::machine_values(&foundation::paths::Environment::current(&data_dir))
            .is_debugging;
    let catalog = Catalog::new(
        &stores,
        &data_dir,
        options.kubeconfig.clone(),
        catalog::CatalogLog::new(Arc::clone(&log), debugging),
    );
    let Core {
        messaging,
        clusters,
        ..
    } = match register_core(
        checks,
        context.package_info().version.to_string(),
        &catalog,
        &stores,
        &log,
    ) {
        Ok(core) => core,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    // The login shell's environment, for the credential plugins; it does not
    // hold the window back (specs/009-main-cluster-connection, FR-033).
    let shell = tauri::async_runtime::block_on(async {
        foundation::shell_env::ShellEnv::start(
            stores.preferences().shell.as_deref(),
            Arc::clone(&log),
        )
    });
    shell.deliver_failures(&messaging.sender());
    clusters.set_shell(shell.clone());
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
    if let Some(path) = &options.catalog_dump {
        catalog.dump_to(path.clone());
    }
    let starting = catalog.clone();
    let stopping = catalog.clone();
    let catalog_marks = options.catalog_dump.is_some();
    let scenario_lists = options.scenario == Some(options::Scenario::Lists);
    let state = Arc::new(scheme::State {
        catalog,
        open_cluster: options.open_cluster,
        log: Box::new({
            let log = Arc::clone(&log);
            move |line| log(line)
        }),
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
    // The /api-kube/ routes of the cluster frames (specs/009-main-cluster-connection).
    let added = added.and_then(|()| cluster::api_kube::register(&mut routes, &clusters));
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
        .on_page_load({
            let log = Arc::clone(&log);
            move |webview, payload| {
                if webview.label() == "main"
                    && payload.event() == PageLoadEvent::Finished
                    && !loaded.swap(true, Ordering::SeqCst)
                {
                    log("Window \"main\" loaded");
                }
            }
        })
        .setup({
            let log = Arc::clone(&log);
            move |app| {
                let runs: Vec<&str> = [
                    (checks.messaging, "messaging-check"),
                    (checks.frames, "frames-check"),
                    (catalog_marks, "catalog-marks"),
                    (scenario_lists, "scenario=lists"),
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
                    // A hidden window's page is slowed, not stopped, as the
                    // Electron build's is by default: a stopped page polls no
                    // message, and its queue closes after a minute (research
                    // R7 of spec 008).
                    .background_throttling(BackgroundThrottlingPolicy::Throttle)
                    // A non-persistent website data store: no run leaves data behind.
                    .incognito(true)
                    // The main window stays on the scheme, whatever a frame tries
                    // (FR-024, research R12). No `on_new_window`: by default
                    // nothing opens.
                    .on_navigation(move |url| {
                        let allowed = routes::allows_navigation(url, &navigating.catalog);
                        if !allowed {
                            log(&format!(
                                "Frames: refused a navigation of the main window to {}",
                                url.scheme()
                            ));
                        }
                        allowed
                    })
                    .build()?;
                // The syncs are scanned once the window is built, so that the
                // scan never delays it (research R12 of spec 007, SC-006).
                starting.start();
                catalog::weblinks::start(
                    &starting,
                    catalog::weblinks::checker(
                        foundation::download::Trust::Platform,
                        catalog::weblinks::CheckTiming::default().limit,
                    ),
                    catalog::weblinks::CheckTiming::default(),
                );
                Ok(())
            }
        })
        .build(context)
        .expect("error while building the application")
        .run(move |_, event| {
            // The event loop ends the process without dropping the locals of
            // `run`, so the lock is released here.
            if let tauri::RunEvent::Exit = event {
                stopping.stop();
                shell.stop();
                drop(instance_lock.lock().ok().and_then(|mut lock| lock.take()));
            }
        });
}
