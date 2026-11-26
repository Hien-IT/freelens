/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Launch options, as `specs/001-tauri-shell-spike/contracts/launch-options.md`
//! specifies them.

use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOptions {
    /// `--kubeconfig=<path>`, resolved against the working directory: a file
    /// synced for the run beside the syncs of the settings, never written to
    /// them (`specs/008-main-catalog`, FR-021). `--kubeconfig=none` and no
    /// option add nothing.
    pub kubeconfig: Option<PathBuf>,
    /// `--open-cluster=<context name>`: opened once the catalog is shown, for
    /// measurement runs.
    pub open_cluster: Option<String>,
    /// `--messaging-check`: registers the check-only channels and runs the
    /// rounds of `specs/002-messaging-for-tauri/contracts/check-log.md`.
    pub messaging_check: bool,
    /// `--frames-check`: registers the check-only channels and runs the steps
    /// of `specs/004-cluster-frames/contracts/frames-log.md`.
    pub frames_check: bool,
    /// `--data-dir=<path>`: the data directory to use instead of the Electron
    /// build's, resolved against the working directory; for measurements and
    /// tests (`specs/007-main-foundation`, research R6).
    pub data_dir: Option<PathBuf>,
    /// `--catalog-dump=<path>`: appends each catalog the core sends to this
    /// file, one JSON line each, resolved against the working directory; for
    /// measurements and tests (`specs/008-main-catalog`, research R12).
    pub catalog_dump: Option<PathBuf>,
    /// `--scenario=lists`: the pages run the scenario of `specs/baseline.md`
    /// themselves and mark each step with the wall clock, for measurements
    /// (`specs/009-main-cluster-connection`, research R15).
    pub scenario: Option<Scenario>,
    /// `--messages-dump=<path>`: appends every message the core sends to this
    /// file, one JSON line each, resolved against the working directory; for
    /// measurements and tests (`specs/009-main-cluster-connection`, research
    /// R17).
    pub messages_dump: Option<PathBuf>,
}

/// A scenario the pages run for measurements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scenario {
    /// Open the cluster, Config Maps with All Namespaces, then Pods.
    Lists,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OptionsError {
    Unknown(String),
    MissingValue(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown(option) => write!(f, "unknown option: {option}"),
            Self::MissingValue(option) => write!(f, "option {option} needs a value"),
        }
    }
}

/// Parses the process arguments, without the program name.
pub fn parse<I>(args: I, cwd: &Path) -> Result<LaunchOptions, OptionsError>
where
    I: IntoIterator<Item = String>,
{
    let mut kubeconfig = None;
    let mut open_cluster = None;
    let mut messaging_check = false;
    let mut frames_check = false;
    let mut data_dir = None;
    let mut catalog_dump = None;
    let mut scenario = None;
    let mut messages_dump = None;

    for arg in args {
        match arg.split_once('=') {
            Some(("--kubeconfig", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--kubeconfig", "none")) => kubeconfig = None,
            Some(("--kubeconfig", path)) => kubeconfig = Some(cwd.join(path)),
            Some(("--open-cluster", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--open-cluster", name)) => open_cluster = Some(name.to_string()),
            Some(("--data-dir", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--data-dir", path)) => data_dir = Some(cwd.join(path)),
            Some(("--catalog-dump", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--catalog-dump", path)) => catalog_dump = Some(cwd.join(path)),
            Some(("--scenario", "lists")) => scenario = Some(Scenario::Lists),
            Some(("--messages-dump", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--messages-dump", path)) => messages_dump = Some(cwd.join(path)),
            None if arg == "--messaging-check" => messaging_check = true,
            None if arg == "--frames-check" => frames_check = true,
            None if [
                "--kubeconfig",
                "--open-cluster",
                "--data-dir",
                "--catalog-dump",
                "--scenario",
                "--messages-dump",
            ]
            .contains(&arg.as_str()) =>
            {
                return Err(OptionsError::MissingValue(arg));
            }
            _ => return Err(OptionsError::Unknown(arg)),
        }
    }

    Ok(LaunchOptions {
        kubeconfig,
        open_cluster,
        messaging_check,
        frames_check,
        data_dir,
        catalog_dump,
        scenario,
        messages_dump,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(args: &[&str]) -> Result<LaunchOptions, OptionsError> {
        parse(args.iter().map(|arg| arg.to_string()), Path::new("/work"))
    }

    #[test]
    fn no_option_adds_no_file() {
        assert_eq!(parse_args(&[]).unwrap().kubeconfig, None);
    }

    #[test]
    fn a_path_is_resolved_against_the_working_directory() {
        assert_eq!(
            parse_args(&["--kubeconfig=configs/kind.yaml"])
                .unwrap()
                .kubeconfig,
            Some(PathBuf::from("/work/configs/kind.yaml"))
        );
        assert_eq!(
            parse_args(&["--kubeconfig=/abs/kind.yaml"])
                .unwrap()
                .kubeconfig,
            Some(PathBuf::from("/abs/kind.yaml"))
        );
    }

    #[test]
    fn none_adds_no_file() {
        assert_eq!(parse_args(&["--kubeconfig=none"]).unwrap().kubeconfig, None);
    }

    #[test]
    fn a_missing_value_is_an_error() {
        assert_eq!(
            parse_args(&["--kubeconfig"]),
            Err(OptionsError::MissingValue("--kubeconfig".into()))
        );
        assert_eq!(
            parse_args(&["--kubeconfig="]),
            Err(OptionsError::MissingValue("--kubeconfig=".into()))
        );
    }

    #[test]
    fn an_unknown_option_is_an_error() {
        assert_eq!(
            parse_args(&["--verbose"]),
            Err(OptionsError::Unknown("--verbose".into()))
        );
        assert_eq!(
            parse_args(&["--kube=x"]),
            Err(OptionsError::Unknown("--kube=x".into()))
        );
    }

    #[test]
    fn open_cluster_names_a_context() {
        let options = parse_args(&["--kubeconfig=none", "--open-cluster=kind-x"]).unwrap();
        assert_eq!(options.open_cluster.as_deref(), Some("kind-x"));
        assert_eq!(parse_args(&[]).unwrap().open_cluster, None);
        for arg in ["--open-cluster", "--open-cluster="] {
            assert_eq!(
                parse_args(&[arg]),
                Err(OptionsError::MissingValue(arg.into()))
            );
        }
    }

    #[test]
    fn messaging_check_takes_no_value() {
        assert!(parse_args(&["--messaging-check"]).unwrap().messaging_check);
        assert!(!parse_args(&[]).unwrap().messaging_check);
        assert_eq!(
            parse_args(&["--messaging-check=yes"]),
            Err(OptionsError::Unknown("--messaging-check=yes".into()))
        );
    }

    #[test]
    fn frames_check_takes_no_value() {
        assert!(parse_args(&["--frames-check"]).unwrap().frames_check);
        assert!(!parse_args(&[]).unwrap().frames_check);
        assert!(!parse_args(&["--messaging-check"]).unwrap().frames_check);
        assert_eq!(
            parse_args(&["--frames-check=yes"]),
            Err(OptionsError::Unknown("--frames-check=yes".into()))
        );
    }

    #[test]
    fn data_dir_is_resolved_against_the_working_directory() {
        assert_eq!(parse_args(&[]).unwrap().data_dir, None);
        assert_eq!(
            parse_args(&["--data-dir=seed"]).unwrap().data_dir,
            Some(PathBuf::from("/work/seed"))
        );
        assert_eq!(
            parse_args(&["--data-dir=/tmp/seed"]).unwrap().data_dir,
            Some(PathBuf::from("/tmp/seed"))
        );
        for arg in ["--data-dir", "--data-dir="] {
            assert_eq!(
                parse_args(&[arg]),
                Err(OptionsError::MissingValue(arg.into()))
            );
        }
    }

    #[test]
    fn messages_dump_is_resolved_against_the_working_directory() {
        assert_eq!(parse_args(&[]).unwrap().messages_dump, None);
        assert_eq!(
            parse_args(&["--messages-dump=out/messages.jsonl"])
                .unwrap()
                .messages_dump,
            Some(PathBuf::from("/work/out/messages.jsonl"))
        );
        for arg in ["--messages-dump", "--messages-dump="] {
            assert_eq!(
                parse_args(&[arg]),
                Err(OptionsError::MissingValue(arg.into()))
            );
        }
    }

    #[test]
    fn scenario_names_lists_only() {
        assert_eq!(parse_args(&[]).unwrap().scenario, None);
        assert_eq!(
            parse_args(&["--scenario=lists"]).unwrap().scenario,
            Some(Scenario::Lists)
        );
        assert_eq!(
            parse_args(&["--scenario=other"]),
            Err(OptionsError::Unknown("--scenario=other".into()))
        );
        assert_eq!(
            parse_args(&["--scenario"]),
            Err(OptionsError::MissingValue("--scenario".into()))
        );
    }

    #[test]
    fn catalog_dump_is_resolved_against_the_working_directory() {
        assert_eq!(parse_args(&[]).unwrap().catalog_dump, None);
        assert_eq!(
            parse_args(&["--catalog-dump=out/catalog.json"])
                .unwrap()
                .catalog_dump,
            Some(PathBuf::from("/work/out/catalog.json"))
        );
        for arg in ["--catalog-dump", "--catalog-dump="] {
            assert_eq!(
                parse_args(&[arg]),
                Err(OptionsError::MissingValue(arg.into()))
            );
        }
    }
}
