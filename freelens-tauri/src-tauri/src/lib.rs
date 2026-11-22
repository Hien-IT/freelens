/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

pub mod catalog;
pub mod options;
pub mod scheme;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::webview::PageLoadEvent;
use tauri::{WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let options = match options::parse(std::env::args().skip(1), &cwd) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let state = Arc::new(scheme::State {
        catalog: catalog::Catalog::load(&options.kubeconfig, home.as_deref()),
        log: Box::new(|line| println!("{line}")),
    });
    let loaded = AtomicBool::new(false);

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            scheme::SCHEME,
            move |context, request, responder| {
                let app = context.app_handle().clone();
                let state = Arc::clone(&state);
                tauri::async_runtime::spawn(async move {
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
        .setup(|app| {
            let url = format!("{}://{}/", scheme::SCHEME, scheme::MAIN_HOST).parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("Freelens Spike")
                .inner_size(1200.0, 800.0)
                // A non-persistent website data store: no run leaves data behind.
                .incognito(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
