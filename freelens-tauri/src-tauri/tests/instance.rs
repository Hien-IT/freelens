/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! One build per data directory: the cases of
//! `specs/007-main-foundation/contracts/instance-lock.md` for the Tauri build.

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use freelens_tauri::instance::{self, Build, ELECTRON_LINK, TAURI_LINK};
use freelens_tauri::messaging::Log;

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "freelens-instance-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A process that is alive for the length of a test.
struct Alive(Child);

impl Alive {
    fn start() -> Self {
        Self(Command::new("sleep").arg("60").spawn().unwrap())
    }

    fn pid(&self) -> u32 {
        self.0.id()
    }
}

impl Drop for Alive {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The pid of a process that has ended and been reaped.
fn dead_pid() -> u32 {
    let mut child = Command::new("true").spawn().unwrap();
    let pid = child.id();
    child.wait().unwrap();
    pid
}

fn link(dir: &Path, name: &str, target: &str) {
    symlink(target, dir.join(name)).unwrap();
}

fn target_of(dir: &Path, name: &str) -> Option<String> {
    fs::read_link(dir.join(name))
        .ok()
        .map(|target| target.to_string_lossy().into_owned())
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn recording_log() -> (Log, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    (log, lines)
}

fn own_target() -> String {
    format!("{}-{}", instance::this_host(), std::process::id())
}

#[test]
fn with_no_link_it_starts_and_creates_its_link() {
    let dir = TempDir::new();
    let (log, _) = recording_log();
    let lock = instance::acquire(&dir.0, &log).unwrap();
    assert_eq!(target_of(&dir.0, TAURI_LINK), Some(own_target()));
    drop(lock);
    assert_eq!(target_of(&dir.0, TAURI_LINK), None);
}

#[test]
fn it_creates_a_missing_data_directory() {
    let dir = TempDir::new();
    let data_dir = dir.0.join("Freelens");
    let (log, _) = recording_log();
    let _lock = instance::acquire(&data_dir, &log).unwrap();
    assert_eq!(target_of(&data_dir, TAURI_LINK), Some(own_target()));
}

#[test]
fn a_live_electron_build_is_refused_and_nothing_is_written() {
    let dir = TempDir::new();
    let electron = Alive::start();
    let target = format!("{}-{}", instance::this_host(), electron.pid());
    link(&dir.0, ELECTRON_LINK, &target);
    let (log, lines) = recording_log();
    let refusal = instance::acquire(&dir.0, &log).unwrap_err();
    assert_eq!(refusal.build, Build::Electron);
    assert_eq!(refusal.target, target);
    assert_eq!(names(&dir.0), [ELECTRON_LINK]);
    assert_eq!(
        lines.lock().unwrap().as_slice(),
        [refusal.log_line()],
        "the refusal is logged"
    );
    assert!(
        refusal
            .log_line()
            .starts_with("error: Instance: Electron build runs on ")
    );
}

#[test]
fn an_electron_link_of_a_dead_process_does_not_stop_the_start() {
    let dir = TempDir::new();
    link(
        &dir.0,
        ELECTRON_LINK,
        &format!("{}-{}", instance::this_host(), dead_pid()),
    );
    let (log, _) = recording_log();
    let _lock = instance::acquire(&dir.0, &log).unwrap();
    assert_eq!(target_of(&dir.0, TAURI_LINK), Some(own_target()));
}

#[test]
fn a_live_tauri_build_is_refused() {
    let dir = TempDir::new();
    let other = Alive::start();
    let target = format!("{}-{}", instance::this_host(), other.pid());
    link(&dir.0, TAURI_LINK, &target);
    let (log, _) = recording_log();
    let refusal = instance::acquire(&dir.0, &log).unwrap_err();
    assert_eq!(refusal.build, Build::Tauri);
    assert_eq!(target_of(&dir.0, TAURI_LINK), Some(target));
}

#[test]
fn a_tauri_link_of_a_dead_process_is_replaced() {
    let dir = TempDir::new();
    link(
        &dir.0,
        TAURI_LINK,
        &format!("{}-{}", instance::this_host(), dead_pid()),
    );
    let (log, _) = recording_log();
    let _lock = instance::acquire(&dir.0, &log).unwrap();
    assert_eq!(target_of(&dir.0, TAURI_LINK), Some(own_target()));
}

#[test]
fn a_link_of_another_host_is_live() {
    for name in [ELECTRON_LINK, TAURI_LINK] {
        let dir = TempDir::new();
        link(&dir.0, name, "another-host.example-1");
        let (log, _) = recording_log();
        assert!(instance::acquire(&dir.0, &log).is_err(), "for {name}");
    }
}

#[test]
fn a_target_that_does_not_parse_is_replaced() {
    let dir = TempDir::new();
    link(&dir.0, TAURI_LINK, "not a target");
    link(&dir.0, ELECTRON_LINK, "nohyphen");
    let (log, _) = recording_log();
    let _lock = instance::acquire(&dir.0, &log).unwrap();
    assert_eq!(target_of(&dir.0, TAURI_LINK), Some(own_target()));
}

#[test]
fn a_data_directory_that_cannot_be_written_starts_without_a_link() {
    let dir = TempDir::new();
    fs::set_permissions(&dir.0, fs::Permissions::from_mode(0o555)).unwrap();
    let (log, lines) = recording_log();
    let lock = instance::acquire(&dir.0, &log).unwrap();
    assert_eq!(target_of(&dir.0, TAURI_LINK), None);
    assert!(
        lines.lock().unwrap()[0].starts_with("error: Instance: cannot write "),
        "{:?}",
        lines.lock().unwrap()
    );
    drop(lock);
}

#[test]
fn a_data_directory_that_cannot_be_written_still_refuses_a_live_electron_build() {
    let dir = TempDir::new();
    let electron = Alive::start();
    link(
        &dir.0,
        ELECTRON_LINK,
        &format!("{}-{}", instance::this_host(), electron.pid()),
    );
    fs::set_permissions(&dir.0, fs::Permissions::from_mode(0o555)).unwrap();
    let (log, _) = recording_log();
    let refusal = instance::acquire(&dir.0, &log).unwrap_err();
    assert_eq!(refusal.build, Build::Electron);
}

#[test]
fn two_data_directories_do_not_see_each_other() {
    let first = TempDir::new();
    let second = TempDir::new();
    let (log, _) = recording_log();
    let _first = instance::acquire(&first.0, &log).unwrap();
    let _second = instance::acquire(&second.0, &log).unwrap();
}

#[test]
fn the_link_is_removed_on_drop_only_while_it_is_its_own() {
    let dir = TempDir::new();
    let (log, _) = recording_log();
    let lock = instance::acquire(&dir.0, &log).unwrap();
    fs::remove_file(dir.0.join(TAURI_LINK)).unwrap();
    link(&dir.0, TAURI_LINK, "someone-else-1");
    drop(lock);
    assert_eq!(
        target_of(&dir.0, TAURI_LINK),
        Some("someone-else-1".to_string())
    );
}

#[test]
fn the_alert_names_the_build_the_data_directory_and_the_link() {
    let dir = TempDir::new();
    let other = Alive::start();
    link(
        &dir.0,
        TAURI_LINK,
        &format!("{}-{}", instance::this_host(), other.pid()),
    );
    let (log, _) = recording_log();
    let refusal = instance::acquire(&dir.0, &log).unwrap_err();
    assert_eq!(refusal.message(), "Freelens is already running");
    assert_eq!(
        refusal.informative_text(),
        format!(
            "The Tauri build of Freelens is using {}. Quit it, then start this one again. If it is not running, delete {}.",
            dir.0.display(),
            dir.0.join(TAURI_LINK).display()
        )
    );
}
