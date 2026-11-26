/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster connection of `specs/009-main-cluster-connection` against the
//! fake API server.

mod fake_api;

use fake_api::{Answer, Context, FakeApi, Tls, User, temp_dir, write_kubeconfig};
use kube::config::{KubeConfigOptions, Kubeconfig};
use serde_json::json;

async fn kube_client(file: &std::path::Path, context: &str) -> kube::Client {
    let kubeconfig = Kubeconfig::read_from(file).unwrap();
    let options = KubeConfigOptions {
        context: Some(context.into()),
        ..Default::default()
    };
    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .unwrap();
    kube::Client::try_from(config).unwrap()
}

// The fake API server itself.

#[tokio::test]
async fn the_fake_api_answers_kube_over_tls_with_a_client_certificate() {
    let dir = temp_dir("fake-api-tls");
    let api = FakeApi::start(Tls::ClientAuth, &dir).await;
    api.set(
        "GET",
        "/version",
        Answer::json(200, json!({"gitVersion": "v1.37.0"})),
    );
    let file = dir.join("config");
    write_kubeconfig(
        &file,
        Some(&api),
        &[Context::new("tls", &api, User::ClientCert)],
    );
    let client = kube_client(&file, "tls").await;
    let version = client.apiserver_version().await.unwrap();
    assert_eq!(version.git_version, "v1.37.0");
    let request = &api.requests_of("/version")[0];
    assert_eq!(
        request.client_cert.as_deref(),
        Some(
            api.certificates
                .as_ref()
                .unwrap()
                .client_cert_der
                .as_slice()
        )
    );
}

#[tokio::test]
async fn the_fake_api_streams_and_counts_connections() {
    let dir = temp_dir("fake-api-stream");
    let api = FakeApi::start(Tls::None, &dir).await;
    let stream = api.stream("/api/v1/pods");
    let file = dir.join("config");
    write_kubeconfig(
        &file,
        Some(&api),
        &[Context::new(
            "plain",
            &api,
            User::Token(fake_api::TOKEN.into()),
        )],
    );
    let client = kube_client(&file, "plain").await;
    let request = http::Request::get("/api/v1/pods?watch=1")
        .body(Vec::new())
        .unwrap();
    let response = client.send(request.map(Into::into)).await.unwrap();
    assert_eq!(response.status(), 200);
    stream.wait_opened(1).await;
    assert!(api.open_connections() >= 1);
    stream.send("{\"type\":\"ADDED\"}\n");
    stream.end();
    let body = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    assert_eq!(&body[..], b"{\"type\":\"ADDED\"}\n");
    let recorded = &api.requests_of("/api/v1/pods")[0];
    assert_eq!(recorded.query.as_deref(), Some("watch=1"));
    assert_eq!(
        recorded.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
}
