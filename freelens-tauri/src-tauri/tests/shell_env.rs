/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The shell sync of `specs/009-main-cluster-connection/contracts/shell-sync.md`,
//! with real shells written as scripts in a temporary directory.

mod fake_api;

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fake_api::temp_dir;
use freelens_tauri::catalog::Catalog;
use freelens_tauri::foundation::shell_env::{Env, ShellEnv};
use freelens_tauri::messaging::{Channels, Log, Messaging, routes};
use http::{Method, Request, header};
use serde_json::{Value, json};

const MAIN: &str = "freelens-app://renderer.freelens.app";

fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn core_env() -> Env {
    HashMap::from([
        ("PATH".to_string(), "/usr/bin:/bin".to_string()),
        ("HOME".to_string(), "/core-home".to_string()),
    ])
}

struct Logged(Arc<Mutex<Vec<String>>>);

fn log() -> (Log, Logged) {
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    (
        Arc::new(move |line| sink.lock().unwrap().push(line.to_string())),
        Logged(lines),
    )
}

async fn poll(messaging: &Messaging, session: &str) -> Vec<Value> {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{MAIN}/ipc/poll"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({"session": session, "after": 0})
                .to_string()
                .into_bytes(),
        )
        .unwrap();
    let response = tokio::time::timeout(
        Duration::from_millis(300),
        routes::handle(request, &Catalog::empty(), messaging),
    )
    .await;
    match response {
        Ok(response) => {
            let body: Value = serde_json::from_slice(response.body()).unwrap();
            body["messages"].as_array().unwrap().clone()
        }
        // The poll waits: nothing came.
        Err(_) => Vec::new(),
    }
}

#[tokio::test]
async fn the_login_shell_s_environment_is_merged_and_never_logged() {
    let dir = temp_dir("shell-ok");
    // A shell that adds a folder to PATH and a variable, as a profile does.
    let shell = script(
        &dir,
        "testshell",
        "export FROM_SHELL=placeholder-shell-secret\nexport PATH=/opt/test/bin:$PATH\neval \"$4\"\n",
    );
    let (log, logged) = log();
    let started = Instant::now();
    let shell_env = ShellEnv::start_with(
        shell.to_string_lossy().into_owned(),
        core_env(),
        "en-US".into(),
        Duration::from_secs(10),
        log,
    );
    // It does not hold the caller back (FR-033).
    assert!(started.elapsed() < Duration::from_millis(100));

    let vars = shell_env.vars().await;
    assert_eq!(vars["FROM_SHELL"], "placeholder-shell-secret");
    assert!(vars["PATH"].starts_with("/opt/test/bin:"));
    assert!(vars["PATH"].ends_with("/usr/bin:/bin"));
    assert_eq!(vars["HOME"], "/core-home");
    assert_eq!(vars["LANG"], "en_US.UTF-8");
    assert!(!vars.contains_key("ITERM_SHELL_INTEGRATION_INSTALLED"));
    assert_eq!(shell_env.take_failure(), None);
    let lines = logged.0.lock().unwrap().clone();
    assert_eq!(
        lines,
        [
            "🐚 Syncing shell environment",
            "[SHELL-SYNC]: Synced shell env"
        ]
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("placeholder-shell-secret"))
    );
}

// pc/features/shell-sync/startup-failure-notification.test.ts

#[tokio::test]
async fn a_failure_reaches_the_main_window_once_when_its_page_loads() {
    let dir = temp_dir("shell-fails");
    let shell = script(
        &dir,
        "testshell",
        "echo some-shell-sync-error >&2\nexit 1\n",
    );
    let (log, logged) = log();
    let channels = Channels::with_log(Arc::clone(&log));
    let sender = channels.sender();
    let messaging = channels.build();
    let shell_env = ShellEnv::start_with(
        shell.to_string_lossy().into_owned(),
        core_env(),
        "en-US".into(),
        Duration::from_secs(10),
        log,
    );
    shell_env.deliver_failures(&sender);
    // The core's own environment, when the shell fails.
    assert_eq!(*shell_env.vars().await, core_env());

    let first = poll(&messaging, "s1").await;
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["channel"], "shell-sync-failed-channel");
    let text = first[0]["payload"].as_str().unwrap();
    assert!(text.starts_with("Shell did not exit successfully: {"));
    assert!(text.contains("some-shell-sync-error"));
    assert!(
        logged
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.starts_with("[SHELL-SYNC]: Shell did not exit successfully"))
    );

    // A reload of the main window does not show it again.
    assert!(poll(&messaging, "s2").await.is_empty());
}

#[tokio::test]
async fn a_success_sends_nothing() {
    let dir = temp_dir("shell-quiet");
    let shell = script(&dir, "testshell", "eval \"$4\"\n");
    let (log, _) = log();
    let channels = Channels::with_log(Arc::clone(&log));
    let sender = channels.sender();
    let messaging = channels.build();
    let shell_env = ShellEnv::start_with(
        shell.to_string_lossy().into_owned(),
        core_env(),
        "en-US".into(),
        Duration::from_secs(10),
        log,
    );
    shell_env.deliver_failures(&sender);
    shell_env.vars().await;
    assert!(poll(&messaging, "s1").await.is_empty());
}

#[tokio::test]
async fn a_shell_past_its_limit_is_killed_with_its_children() {
    let dir = temp_dir("shell-slow");
    let pid_file = dir.join("child.pid");
    let shell = script(
        &dir,
        "testshell",
        &format!("sleep 30 &\necho $! > '{}'\nwait\n", pid_file.display()),
    );
    let (log, _) = log();
    let shell_env = ShellEnv::start_with(
        shell.to_string_lossy().into_owned(),
        core_env(),
        "en-US".into(),
        Duration::from_millis(500),
        log,
    );
    let vars = shell_env.vars().await;
    assert_eq!(*vars, core_env());
    let failure = shell_env.take_failure().unwrap();
    assert!(failure.starts_with(
        "Resolving shell environment is taking very long. Please review your shell configuration: timeout: {"
    ));
    let child: i32 = fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    // SAFETY: signal 0 only asks whether the process exists.
    let alive = unsafe { libc::kill(child, 0) } == 0;
    assert!(!alive, "the shell's child was left running");
}

#[tokio::test]
async fn a_shell_that_cannot_start_fails_with_spawn() {
    let (log, _) = log();
    let shell_env = ShellEnv::start_with(
        "/no/such/shell".into(),
        core_env(),
        "en-US".into(),
        Duration::from_secs(5),
        log,
    );
    shell_env.vars().await;
    assert!(
        shell_env
            .take_failure()
            .unwrap()
            .starts_with("Failed to spawn /no/such/shell: {")
    );
}
