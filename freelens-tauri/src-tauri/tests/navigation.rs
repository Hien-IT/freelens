/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The navigation rule of the main window
//! (`specs/004-cluster-frames/contracts/routes.md`, "Navigation of the main window").

use std::path::Path;

use freelens_tauri::catalog::Catalog;
use freelens_tauri::routes::allows_navigation;
use tauri::Url;

fn catalog() -> Catalog {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml");
    Catalog::from_kubeconfig_file(&path)
}

fn allows(url: &str, catalog: &Catalog) -> bool {
    allows_navigation(&url.parse::<Url>().unwrap(), catalog)
}

#[test]
fn a_url_of_the_scheme_whose_host_names_a_view_is_allowed() {
    let catalog = catalog();
    let id = &catalog.cluster_ids()[1];
    for url in [
        "freelens-app://renderer.freelens.app/".to_string(),
        "freelens-app://renderer.freelens.app/?frames-check".to_string(),
        format!("freelens-app://{id}.renderer.freelens.app/?frames-check&siblings=a,b"),
        format!(
            "freelens-app://{}.RENDERER.FREELENS.APP/",
            id.to_uppercase()
        ),
    ] {
        assert!(allows(&url, &catalog), "{url}");
    }
}

#[test]
fn about_blank_and_about_srcdoc_are_allowed_and_no_other_about_url() {
    let catalog = catalog();
    assert!(allows("about:blank", &catalog));
    assert!(allows("about:srcdoc", &catalog));
    for url in ["about:config", "about:home", "about:srcdoc2"] {
        assert!(!allows(url, &catalog), "{url}");
    }
}

#[test]
fn other_schemes_are_refused() {
    let catalog = catalog();
    for url in [
        "https://example.com/",
        "http://renderer.freelens.app/",
        "https://renderer.freelens.app/",
        "file:///etc/hosts",
        "data:text/html,<p>hi</p>",
        "javascript:void(0)",
        "blob:freelens-app://renderer.freelens.app/0",
    ] {
        assert!(!allows(url, &catalog), "{url}");
    }
}

#[test]
fn a_url_of_the_scheme_whose_host_names_no_view_is_refused() {
    let catalog = catalog();
    let id = &catalog.cluster_ids()[0];
    for url in [
        "freelens-app://example.com/".to_string(),
        "freelens-app://0123456789abcdef0123456789abcdef.renderer.freelens.app/".to_string(),
        "freelens-app://renderer.freelens.app./".to_string(),
        format!("freelens-app://{id}.renderer.freelens.app./"),
        "freelens-app://renderer.freelens.app:1/".to_string(),
        format!("freelens-app://{id}.renderer.freelens.app:443/"),
        "freelens-app://user@renderer.freelens.app/".to_string(),
        format!("freelens-app://user:secret@{id}.renderer.freelens.app/"),
    ] {
        assert!(!allows(&url, &catalog), "{url}");
    }
}
