/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The catalog: one entry per context of the kubeconfig file in effect
//! (`specs/001-tauri-shell-spike/data-model.md`).

use std::path::{Path, PathBuf};

use kube::config::Kubeconfig;
use md5::{Digest, Md5};

use crate::options::{KubeconfigChoice, default_kubeconfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceState {
    Read,
    Missing,
    Invalid,
    NotChosen,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KubeconfigSource {
    pub path: Option<PathBuf>,
    pub state: SourceState,
    /// Whether a launch option named the file, rather than the default.
    pub chosen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub source: PathBuf,
}

pub struct Catalog {
    pub source: KubeconfigSource,
    pub entries: Vec<CatalogEntry>,
    kubeconfig: Option<Kubeconfig>,
}

impl Catalog {
    /// Reads the file of `choice` once. Never fails: a missing or broken file
    /// gives an empty catalog and a state that says why.
    pub fn load(choice: &KubeconfigChoice, home: Option<&Path>) -> Self {
        let (path, chosen) = match choice {
            KubeconfigChoice::None => (None, false),
            KubeconfigChoice::Default => (home.map(default_kubeconfig), false),
            KubeconfigChoice::File(path) => (Some(path.clone()), true),
        };

        let Some(path) = path else {
            let state = match choice {
                KubeconfigChoice::None => SourceState::NotChosen,
                _ => SourceState::Missing,
            };
            return Self::empty(KubeconfigSource {
                path: None,
                state,
                chosen,
            });
        };

        if !path.exists() {
            return Self::empty(KubeconfigSource {
                path: Some(path),
                state: SourceState::Missing,
                chosen,
            });
        }

        match Kubeconfig::read_from(&path) {
            Ok(kubeconfig) => {
                let mut entries: Vec<CatalogEntry> = Vec::new();
                for context in &kubeconfig.contexts {
                    if entries.iter().any(|entry| entry.name == context.name) {
                        continue;
                    }
                    entries.push(CatalogEntry {
                        id: cluster_id(&path, &context.name),
                        name: context.name.clone(),
                        source: path.clone(),
                    });
                }
                Self {
                    source: KubeconfigSource {
                        path: Some(path),
                        state: SourceState::Read,
                        chosen,
                    },
                    entries,
                    kubeconfig: Some(kubeconfig),
                }
            }
            Err(error) => {
                // The parser's text can quote the file, which may hold
                // credentials, so it goes to the terminal and not to a view.
                eprintln!("Cannot read kubeconfig file {}: {error}", path.display());
                Self::empty(KubeconfigSource {
                    path: Some(path),
                    state: SourceState::Invalid,
                    chosen,
                })
            }
        }
    }

    fn empty(source: KubeconfigSource) -> Self {
        Self {
            source,
            entries: Vec::new(),
            kubeconfig: None,
        }
    }

    /// The text the catalog shows, per the state table of the data model.
    pub fn message(&self) -> Option<String> {
        let path = self.source.path.as_deref()?.display();
        match self.source.state {
            SourceState::Missing if self.source.chosen => {
                Some(format!("Kubeconfig file not found: {path}"))
            }
            SourceState::Invalid => Some(format!(
                "Cannot read kubeconfig file {path}: it is not a valid kubeconfig"
            )),
            _ => None,
        }
    }

    pub fn entry(&self, id: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    /// The parsed file, with its credentials, for building cluster clients.
    /// Nothing built from it is ever sent to a view (FR-015).
    pub fn kubeconfig(&self) -> Option<&Kubeconfig> {
        self.kubeconfig.as_ref()
    }
}

/// The id the current build gives a cluster: the MD5 of `<path>:<context>`.
pub fn cluster_id(path: &Path, context: &str) -> String {
    Md5::digest(format!("{}:{context}", path.display()).as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn load_file(name: &str) -> Catalog {
        Catalog::load(&KubeconfigChoice::File(fixture(name)), None)
    }

    #[test]
    fn lists_one_entry_per_context() {
        let catalog = load_file("three-contexts.yaml");
        let names: Vec<&str> = catalog
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["context-a", "context-b", "context-c"]);
        assert_eq!(catalog.source.state, SourceState::Read);
        assert_eq!(catalog.message(), None);
        assert!(catalog.kubeconfig().is_some());
        for entry in &catalog.entries {
            assert_eq!(entry.id.len(), 32);
            assert!(
                entry
                    .id
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            );
            assert_eq!(entry.source, fixture("three-contexts.yaml"));
        }
    }

    #[test]
    fn a_file_without_contexts_is_an_empty_catalog_without_message() {
        let catalog = load_file("no-contexts.yaml");
        assert!(catalog.entries.is_empty());
        assert_eq!(catalog.source.state, SourceState::Read);
        assert_eq!(catalog.message(), None);
    }

    #[test]
    fn an_invalid_file_names_the_file_without_quoting_it() {
        let catalog = load_file("invalid.yaml");
        assert!(catalog.entries.is_empty());
        assert_eq!(catalog.source.state, SourceState::Invalid);
        let message = catalog.message().unwrap();
        assert!(message.contains("invalid.yaml"), "{message}");
        assert!(!message.contains("not a list"), "{message}");
    }

    #[test]
    fn a_missing_chosen_file_names_it() {
        let catalog = Catalog::load(
            &KubeconfigChoice::File(PathBuf::from("/no/such/file")),
            None,
        );
        assert_eq!(catalog.source.state, SourceState::Missing);
        assert_eq!(
            catalog.message().as_deref(),
            Some("Kubeconfig file not found: /no/such/file")
        );
    }

    #[test]
    fn a_missing_default_file_has_no_message() {
        let catalog = Catalog::load(&KubeconfigChoice::Default, Some(Path::new("/no/such/home")));
        assert_eq!(
            catalog.source.path,
            Some(PathBuf::from("/no/such/home/.kube/config"))
        );
        assert_eq!(catalog.source.state, SourceState::Missing);
        assert!(catalog.entries.is_empty());
        assert_eq!(catalog.message(), None);
    }

    #[test]
    fn none_reads_nothing() {
        let catalog = Catalog::load(&KubeconfigChoice::None, Some(Path::new("/Users/me")));
        assert_eq!(catalog.source.path, None);
        assert_eq!(catalog.source.state, SourceState::NotChosen);
        assert_eq!(catalog.message(), None);
    }

    #[test]
    fn the_id_matches_the_current_build() {
        // `md5 -s "/Users/me/.kube/config:kind-freelens-profile"`
        assert_eq!(
            cluster_id(Path::new("/Users/me/.kube/config"), "kind-freelens-profile"),
            "fbfacebb6727e499ecefddb07e27418e"
        );
    }
}
