/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The data directory and the paths of the application, as the Electron build
//! computes them (`specs/007-main-foundation/research.md`, R6).

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

/// Whether the core was built for release or for development, which decides
/// the application's name as `NODE_ENV` decides it in the Electron build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildKind {
    Release,
    Debug,
}

impl BuildKind {
    /// The kind of this build of the core.
    pub fn current() -> Self {
        if cfg!(debug_assertions) {
            Self::Debug
        } else {
            Self::Release
        }
    }

    /// `appName` of the Electron build: the product name, plus `Dev` in a
    /// development build.
    pub fn app_name(self) -> &'static str {
        match self {
            Self::Release => "Freelens",
            Self::Debug => "FreelensDev",
        }
    }
}

/// The home directory of the user database, as Node's `os.userInfo().homedir`
/// reads it for the Electron build, rather than `$HOME`.
pub fn user_home() -> PathBuf {
    // SAFETY: `passwd` is plain data that getpwuid_r fills in; the buffer it
    // points into outlives every read of it below.
    unsafe {
        let mut entry: libc::passwd = std::mem::zeroed();
        let mut buffer = vec![0 as libc::c_char; 16 * 1024];
        let mut found = std::ptr::null_mut();
        let status = libc::getpwuid_r(
            libc::getuid(),
            &mut entry,
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        );
        if status == 0 && !found.is_null() && !entry.pw_dir.is_null() {
            let home = std::ffi::CStr::from_ptr(entry.pw_dir);
            return PathBuf::from(home.to_string_lossy().into_owned());
        }
    }
    std::env::home_dir().unwrap_or_default()
}

/// The directory both builds keep their files in: `--data-dir` when given;
/// else `<FREELENS_INTEGRATION_TESTING_DIR>/<app name>` when that variable is
/// set, wherever it points, as the Electron build's `userData` follows it;
/// else the application support directory of the user.
pub fn data_dir(
    option: Option<&Path>,
    integration_testing_dir: Option<&OsStr>,
    home: &Path,
    build: BuildKind,
) -> PathBuf {
    if let Some(path) = option {
        return path.to_path_buf();
    }
    match integration_testing_dir {
        Some(dir) if !dir.is_empty() => Path::new(dir).join(build.app_name()),
        _ => home
            .join("Library")
            .join("Application Support")
            .join(build.app_name()),
    }
}

/// What the paths and the machine values are computed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
    /// The home directory of the user database.
    pub home: PathBuf,
    /// `FREELENS_INTEGRATION_TESTING_DIR`, when set.
    pub integration_testing_dir: Option<OsString>,
    /// `TMPDIR`, as the process has it.
    pub temp: PathBuf,
    /// The executable of the Tauri build.
    pub exe: PathBuf,
    pub build: BuildKind,
    /// The data directory the core uses.
    pub data_dir: PathBuf,
    /// `DEBUG`, `SNAP` and `FLATPAK_SANDBOX_DIR`.
    pub debug: Option<String>,
    pub snap: Option<OsString>,
    pub flatpak: Option<OsString>,
}

impl Environment {
    /// The environment of this process.
    pub fn current(data_dir: &Path) -> Self {
        Self {
            home: user_home(),
            integration_testing_dir: std::env::var_os("FREELENS_INTEGRATION_TESTING_DIR"),
            temp: std::env::temp_dir(),
            exe: std::env::current_exe().unwrap_or_default(),
            build: BuildKind::current(),
            data_dir: data_dir.to_path_buf(),
            debug: std::env::var("DEBUG").ok(),
            snap: std::env::var_os("SNAP"),
            flatpak: std::env::var_os("FLATPAK_SANDBOX_DIR"),
        }
    }

    /// Where a bundle keeps its resources: `Contents/Resources` of the
    /// application, else the executable's directory, as Tauri resolves it.
    pub fn resources(&self) -> PathBuf {
        let parent = self.exe.parent().unwrap_or(Path::new(""));
        match (parent.file_name(), parent.parent()) {
            (Some(name), Some(contents)) if name == "MacOS" && contents.ends_with("Contents") => {
                contents.join("Resources")
            }
            _ => parent.to_path_buf(),
        }
    }

    fn integration_testing_dir(&self) -> Option<&OsStr> {
        self.integration_testing_dir
            .as_deref()
            .filter(|dir| !dir.is_empty())
    }

    /// `homeDirectory` of the machine values: the home of an integration test
    /// when its directory is under the temporary one, else the user's.
    pub fn home_directory(&self) -> PathBuf {
        let temp = self.temp.to_string_lossy();
        let temp = temp.trim_end_matches('/');
        match self.integration_testing_dir() {
            Some(dir) if dir.to_string_lossy().starts_with(temp) => {
                Path::new(dir).join(self.build.app_name()).join("home")
            }
            _ => self.home.clone(),
        }
    }
}

fn text(path: impl AsRef<Path>) -> Value {
    Value::String(path.as_ref().to_string_lossy().into_owned())
}

/// The answer of `app-paths`, as the Electron build gives it on macOS
/// (`specs/007-main-foundation/contracts/foundation-channels.md`, "app-paths").
pub fn app_paths(env: &Environment) -> Map<String, Value> {
    let home = &env.home;
    let app_data = match env.integration_testing_dir() {
        Some(dir) => PathBuf::from(dir),
        None => home.join("Library").join("Application Support"),
    };
    let mut temp = env.temp.to_string_lossy().into_owned();
    if !temp.ends_with('/') {
        temp.push('/');
    }
    let entries = [
        ("currentApp", text(env.resources())),
        ("home", text(home)),
        ("appData", text(&app_data)),
        ("userData", text(&env.data_dir)),
        ("sessionData", text(&env.data_dir)),
        ("temp", Value::String(temp)),
        ("exe", text(&env.exe)),
        ("module", text(&env.exe)),
        ("desktop", text(home.join("Desktop"))),
        ("documents", text(home.join("Documents"))),
        ("downloads", text(home.join("Downloads"))),
        ("music", text(home.join("Music"))),
        ("pictures", text(home.join("Pictures"))),
        ("videos", text(home.join("Movies"))),
        ("logs", text(logs_dir(home))),
        ("crashDumps", text(env.data_dir.join("Crashpad"))),
        // Electron throws for it on macOS, and the Electron build answers "".
        ("recent", Value::String(String::new())),
    ];
    entries
        .into_iter()
        .map(|(name, value)| (name.to_string(), value))
        .collect()
}

/// `logs` of the Electron build: `~/Library/Logs/Freelens`, in a development
/// build too, since Electron reads it before the name gets its `Dev`.
pub fn logs_dir(home: &Path) -> PathBuf {
    home.join("Library").join("Logs").join("Freelens")
}

/// `MachineValues` of spec 003.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineValues {
    pub platform: &'static str,
    pub is_debugging: bool,
    pub is_snap: bool,
    pub is_flatpak: bool,
    pub home_directory: String,
    pub kube_directory: String,
    pub bundled_helm_path: String,
}

/// The answer of `machine-values`.
pub fn machine_values(env: &Environment) -> MachineValues {
    let set = |value: &Option<OsString>| value.as_deref().is_some_and(|value| !value.is_empty());
    MachineValues {
        platform: "darwin",
        is_debugging: env.debug.as_deref().is_some_and(|value| {
            ["true", "1", "yes", "y", "on"].contains(&value.to_lowercase().as_str())
        }),
        is_snap: set(&env.snap),
        is_flatpak: set(&env.flatpak),
        home_directory: env.home_directory().to_string_lossy().into_owned(),
        kube_directory: env.home.join(".kube").to_string_lossy().into_owned(),
        bundled_helm_path: env
            .resources()
            .join("arm64")
            .join("helm")
            .to_string_lossy()
            .into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/me";

    #[test]
    fn the_option_wins() {
        assert_eq!(
            data_dir(
                Some(Path::new("/tmp/data")),
                Some(OsStr::new("/tmp/it")),
                Path::new(HOME),
                BuildKind::Release
            ),
            PathBuf::from("/tmp/data")
        );
    }

    #[test]
    fn the_integration_testing_directory_holds_the_app_name() {
        for dir in ["/var/folders/x/T/it", "/somewhere/else"] {
            assert_eq!(
                data_dir(
                    None,
                    Some(OsStr::new(dir)),
                    Path::new(HOME),
                    BuildKind::Release
                ),
                Path::new(dir).join("Freelens"),
                "for {dir}"
            );
        }
        assert_eq!(
            data_dir(
                None,
                Some(OsStr::new("/it")),
                Path::new(HOME),
                BuildKind::Debug
            ),
            PathBuf::from("/it/FreelensDev")
        );
    }

    #[test]
    fn an_empty_integration_testing_directory_is_ignored() {
        assert_eq!(
            data_dir(
                None,
                Some(OsStr::new("")),
                Path::new(HOME),
                BuildKind::Release
            ),
            PathBuf::from("/Users/me/Library/Application Support/Freelens")
        );
    }

    #[test]
    fn the_default_is_the_application_support_directory() {
        assert_eq!(
            data_dir(None, None, Path::new(HOME), BuildKind::Release),
            PathBuf::from("/Users/me/Library/Application Support/Freelens")
        );
        assert_eq!(
            data_dir(None, None, Path::new(HOME), BuildKind::Debug),
            PathBuf::from("/Users/me/Library/Application Support/FreelensDev")
        );
    }

    fn environment() -> Environment {
        Environment {
            home: PathBuf::from("/Users/me"),
            integration_testing_dir: None,
            temp: PathBuf::from("/var/folders/x/T/"),
            exe: PathBuf::from("/Applications/Freelens.app/Contents/MacOS/freelens-tauri"),
            build: BuildKind::Release,
            data_dir: PathBuf::from("/Users/me/Library/Application Support/Freelens"),
            debug: None,
            snap: None,
            flatpak: None,
        }
    }

    #[test]
    fn app_paths_answers_the_seventeen_names_as_the_probe_showed_them() {
        let paths = app_paths(&environment());
        let expected = [
            (
                "currentApp",
                "/Applications/Freelens.app/Contents/Resources",
            ),
            ("home", "/Users/me"),
            ("appData", "/Users/me/Library/Application Support"),
            ("userData", "/Users/me/Library/Application Support/Freelens"),
            (
                "sessionData",
                "/Users/me/Library/Application Support/Freelens",
            ),
            ("temp", "/var/folders/x/T/"),
            (
                "exe",
                "/Applications/Freelens.app/Contents/MacOS/freelens-tauri",
            ),
            (
                "module",
                "/Applications/Freelens.app/Contents/MacOS/freelens-tauri",
            ),
            ("desktop", "/Users/me/Desktop"),
            ("documents", "/Users/me/Documents"),
            ("downloads", "/Users/me/Downloads"),
            ("music", "/Users/me/Music"),
            ("pictures", "/Users/me/Pictures"),
            ("videos", "/Users/me/Movies"),
            ("logs", "/Users/me/Library/Logs/Freelens"),
            (
                "crashDumps",
                "/Users/me/Library/Application Support/Freelens/Crashpad",
            ),
            ("recent", ""),
        ];
        let names: Vec<_> = paths.keys().cloned().collect();
        assert_eq!(names, expected.map(|(name, _)| name));
        for (name, value) in expected {
            assert_eq!(paths[name], value, "for {name}");
        }
    }

    #[test]
    fn the_integration_testing_directory_replaces_app_data() {
        let mut env = environment();
        env.integration_testing_dir = Some("/somewhere/it".into());
        env.data_dir = PathBuf::from("/somewhere/it/Freelens");
        let paths = app_paths(&env);
        assert_eq!(paths["appData"], "/somewhere/it");
        assert_eq!(paths["userData"], "/somewhere/it/Freelens");
        assert_eq!(paths["crashDumps"], "/somewhere/it/Freelens/Crashpad");
        assert_eq!(paths["home"], "/Users/me");
    }

    #[test]
    fn temp_gets_its_trailing_slash() {
        let mut env = environment();
        env.temp = PathBuf::from("/tmp");
        assert_eq!(app_paths(&env)["temp"], "/tmp/");
    }

    #[test]
    fn a_development_binary_keeps_its_resources_next_to_it() {
        let mut env = environment();
        env.exe = PathBuf::from("/work/target/debug/freelens-tauri");
        assert_eq!(app_paths(&env)["currentApp"], "/work/target/debug");
        assert_eq!(
            machine_values(&env).bundled_helm_path,
            "/work/target/debug/arm64/helm"
        );
    }

    #[test]
    fn machine_values_follow_the_environment() {
        let values = machine_values(&environment());
        assert_eq!(
            values,
            MachineValues {
                platform: "darwin",
                is_debugging: false,
                is_snap: false,
                is_flatpak: false,
                home_directory: "/Users/me".into(),
                kube_directory: "/Users/me/.kube".into(),
                bundled_helm_path: "/Applications/Freelens.app/Contents/Resources/arm64/helm"
                    .into(),
            }
        );
        assert_eq!(
            serde_json::to_value(&values).unwrap()["bundledHelmPath"],
            "/Applications/Freelens.app/Contents/Resources/arm64/helm"
        );
    }

    #[test]
    fn debugging_is_one_of_the_accepted_values() {
        for (value, expected) in [
            ("true", true),
            ("1", true),
            ("YES", true),
            ("y", true),
            ("On", true),
            ("false", false),
            ("2", false),
            ("", false),
        ] {
            let mut env = environment();
            env.debug = Some(value.into());
            assert_eq!(machine_values(&env).is_debugging, expected, "for {value:?}");
        }
    }

    #[test]
    fn the_packaging_flags_need_a_value() {
        let mut env = environment();
        env.snap = Some("/snap/x".into());
        env.flatpak = Some("".into());
        let values = machine_values(&env);
        assert!(values.is_snap);
        assert!(!values.is_flatpak);
    }

    #[test]
    fn the_integration_testing_home_is_used_under_the_temporary_directory_only() {
        let mut env = environment();
        env.integration_testing_dir = Some("/var/folders/x/T/it".into());
        let values = machine_values(&env);
        assert_eq!(values.home_directory, "/var/folders/x/T/it/Freelens/home");
        assert_eq!(values.kube_directory, "/Users/me/.kube");
        env.integration_testing_dir = Some("/elsewhere/it".into());
        assert_eq!(machine_values(&env).home_directory, "/Users/me");
    }
}
