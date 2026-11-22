/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Launch options, as `specs/001-tauri-shell-spike/contracts/launch-options.md`
//! specifies them.

use std::fmt;
use std::path::{Path, PathBuf};

/// Which kubeconfig file the core reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KubeconfigChoice {
    /// No option: `$HOME/.kube/config`.
    Default,
    /// `--kubeconfig=<path>`, resolved against the working directory.
    File(PathBuf),
    /// `--kubeconfig=none`.
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOptions {
    pub kubeconfig: KubeconfigChoice,
    /// `--open-cluster=<context name>`: opened once the catalog is shown, for
    /// measurement runs.
    pub open_cluster: Option<String>,
    /// `--messaging-check`: registers the check-only channels and runs the
    /// rounds of `specs/002-messaging-for-tauri/contracts/check-log.md`.
    pub messaging_check: bool,
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
    let mut kubeconfig = KubeconfigChoice::Default;
    let mut open_cluster = None;
    let mut messaging_check = false;

    for arg in args {
        match arg.split_once('=') {
            Some(("--kubeconfig", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--kubeconfig", "none")) => kubeconfig = KubeconfigChoice::None,
            Some(("--kubeconfig", path)) => kubeconfig = KubeconfigChoice::File(cwd.join(path)),
            Some(("--open-cluster", "")) => return Err(OptionsError::MissingValue(arg)),
            Some(("--open-cluster", name)) => open_cluster = Some(name.to_string()),
            None if arg == "--messaging-check" => messaging_check = true,
            None if arg == "--kubeconfig" || arg == "--open-cluster" => {
                return Err(OptionsError::MissingValue(arg));
            }
            _ => return Err(OptionsError::Unknown(arg)),
        }
    }

    Ok(LaunchOptions {
        kubeconfig,
        open_cluster,
        messaging_check,
    })
}

/// The file `Default` stands for.
pub fn default_kubeconfig(home: &Path) -> PathBuf {
    home.join(".kube").join("config")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(args: &[&str]) -> Result<LaunchOptions, OptionsError> {
        parse(args.iter().map(|arg| arg.to_string()), Path::new("/work"))
    }

    #[test]
    fn no_option_reads_the_default_file() {
        assert_eq!(
            parse_args(&[]).unwrap().kubeconfig,
            KubeconfigChoice::Default
        );
    }

    #[test]
    fn a_path_is_resolved_against_the_working_directory() {
        assert_eq!(
            parse_args(&["--kubeconfig=configs/kind.yaml"])
                .unwrap()
                .kubeconfig,
            KubeconfigChoice::File(PathBuf::from("/work/configs/kind.yaml"))
        );
        assert_eq!(
            parse_args(&["--kubeconfig=/abs/kind.yaml"])
                .unwrap()
                .kubeconfig,
            KubeconfigChoice::File(PathBuf::from("/abs/kind.yaml"))
        );
    }

    #[test]
    fn none_reads_no_file() {
        assert_eq!(
            parse_args(&["--kubeconfig=none"]).unwrap().kubeconfig,
            KubeconfigChoice::None
        );
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
    fn the_default_file_is_under_home() {
        assert_eq!(
            default_kubeconfig(Path::new("/Users/me")),
            PathBuf::from("/Users/me/.kube/config")
        );
    }
}
