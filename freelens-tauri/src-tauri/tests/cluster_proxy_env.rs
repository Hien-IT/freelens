/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The environment's `HTTPS_PROXY` and `NO_PROXY` for a cluster's client
//! (`specs/009-main-cluster-connection/research.md`, R2). One test alone in
//! its binary, since it sets the process environment, which kube reads.

mod fake_api;

use fake_api::{Answer, ConnectProxy, Context, FakeApi, Tls, User, temp_dir, write_kubeconfig};
use freelens_tauri::catalog::Catalog;
use freelens_tauri::cluster::client::config;
use serde_json::json;

#[test]
fn https_proxy_of_the_environment_is_used_and_no_proxy_honoured() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let (api, proxy, cluster) = runtime.block_on(async {
        let dir = temp_dir("proxy-env");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        let proxy = ConnectProxy::start().await;
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let cluster = Catalog::from_kubeconfig_file(&file).clusters()[0].clone();
        (api, proxy, cluster)
    });

    // SAFETY: the only test of this binary; the runtime's threads read no
    // environment while it changes.
    unsafe {
        std::env::remove_var("https_proxy");
        std::env::remove_var("no_proxy");
        std::env::remove_var("NO_PROXY");
        std::env::set_var("HTTPS_PROXY", proxy.url());
    }
    runtime.block_on(async {
        let config = config(&cluster, None).await.unwrap();
        let client = kube::Client::try_from(config).unwrap();
        client.apiserver_version().await.unwrap();
    });
    assert_eq!(proxy.targets(), [format!("127.0.0.1:{}", api.port)]);

    // SAFETY: as above.
    unsafe {
        std::env::set_var("NO_PROXY", "127.0.0.1");
    }
    runtime.block_on(async {
        let config = config(&cluster, None).await.unwrap();
        let client = kube::Client::try_from(config).unwrap();
        client.apiserver_version().await.unwrap();
    });
    assert_eq!(proxy.targets().len(), 1, "NO_PROXY goes direct");
    assert_eq!(api.requests_of("/version").len(), 2);
}
