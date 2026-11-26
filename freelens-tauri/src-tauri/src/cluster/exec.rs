/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Credential plugins, run by the core itself
//! (`specs/009-main-cluster-connection/research.md`, R3): once per cluster at
//! a time, with the login shell's environment, and killed with their process
//! group on a disconnect and on quit. Their output is a credential and is
//! never logged.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use k8s_openapi::jiff::{SignedDuration, Timestamp};
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;
use tokio::sync::watch;
use tokio::task::AbortHandle;

use crate::foundation::shell_env::ShellEnv;

/// A credential is renewed this long before it expires, as kube renews one.
const RENEW_BEFORE: Duration = Duration::from_secs(60);

/// The `exec` of a kubeconfig user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plugin {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub api_version: String,
    pub interactive_mode: Option<String>,
    pub provide_cluster_info: bool,
    /// The folder of the kubeconfig file, which a relative command is read
    /// against.
    pub base_dir: PathBuf,
    /// What `spec.cluster` holds with `provideClusterInfo`.
    pub cluster_info: Value,
}

impl Plugin {
    /// The `exec` of a kubeconfig user as kube parses it, and the cluster of
    /// its context, both as JSON.
    pub fn from_kubeconfig(exec: &Value, cluster: &Value, base_dir: &Path) -> Option<Self> {
        let command = exec.get("command")?.as_str()?.to_string();
        let strings = |value: Option<&Value>| -> Vec<String> {
            value
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        };
        let env = exec
            .get("env")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                Some((
                    entry.get("name")?.as_str()?.to_string(),
                    entry.get("value")?.as_str()?.to_string(),
                ))
            })
            .collect();
        Some(Self {
            command,
            args: strings(exec.get("args")),
            env,
            api_version: exec
                .get("apiVersion")
                .and_then(Value::as_str)
                .unwrap_or("client.authentication.k8s.io/v1")
                .to_string(),
            interactive_mode: exec
                .get("interactiveMode")
                .and_then(Value::as_str)
                .map(str::to_string),
            provide_cluster_info: exec
                .get("provideClusterInfo")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            base_dir: base_dir.to_path_buf(),
            cluster_info: cluster.clone(),
        })
    }
}

/// What a plugin returned (data-model.md, Credential).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub token: Option<String>,
    /// The PEM of the client certificate and of its key; wins over a token.
    pub client_tls: Option<(String, String)>,
    pub expires_at: Option<Timestamp>,
}

impl Credential {
    /// Whether it can still be used at `now`: until 60 s before its expiry.
    pub fn is_fresh(&self, now: Timestamp) -> bool {
        self.expires_at.is_none_or(|expiry| {
            now.checked_add(SignedDuration::try_from(RENEW_BEFORE).expect("a small duration"))
                .is_ok_and(|limit| limit < expiry)
        })
    }
}

type Outcome = Option<Result<Credential, String>>;

struct Run {
    result: watch::Receiver<Outcome>,
    abort: AbortHandle,
    group: Arc<Mutex<Option<i32>>>,
}

/// Called with the cluster id and each chunk a plugin writes to stderr.
pub type StderrListener = Arc<dyn Fn(&str, &str) + Send + Sync>;

#[derive(Default)]
struct State {
    credentials: HashMap<String, Credential>,
    runs: HashMap<String, Run>,
    on_stderr: Option<StderrListener>,
}

/// The runs and credentials of the plugins, by cluster id.
#[derive(Clone, Default)]
pub struct Runner {
    state: Arc<Mutex<State>>,
}

impl Runner {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("the plugins lock")
    }

    /// Gets what the plugins write to stderr from now on, as the Electron
    /// build shows its proxy's stderr, where client-go passes it through: a
    /// login prompt of the plugin, say.
    pub fn on_stderr(&self, listener: StderrListener) {
        self.state().on_stderr = Some(listener);
    }

    /// The credential of `cluster`: the one kept while fresh, else the result
    /// of a run, which a second caller shares (data-model.md,
    /// `Credential.run`). The run goes on when the caller stops waiting.
    pub async fn credential(
        &self,
        cluster: &str,
        plugin: &Plugin,
        shell: &ShellEnv,
    ) -> Result<Credential, String> {
        let mut receiver = {
            let mut state = self.state();
            if let Some(credential) = state.credentials.get(cluster)
                && credential.is_fresh(Timestamp::now())
            {
                return Ok(credential.clone());
            }
            match state.runs.get(cluster) {
                Some(run) => run.result.clone(),
                None => {
                    let (sender, receiver) = watch::channel(None);
                    let group: Arc<Mutex<Option<i32>>> = Arc::default();
                    let runner = self.clone();
                    let id = cluster.to_string();
                    let plugin = plugin.clone();
                    let shell = shell.clone();
                    let running_group = Arc::clone(&group);
                    let on_stderr = state.on_stderr.clone();
                    let task = tokio::spawn(async move {
                        let report = |chunk: &str| {
                            if let Some(listener) = &on_stderr {
                                listener(&id, chunk);
                            }
                        };
                        let result = run(&plugin, &shell, &running_group, &report).await;
                        let mut state = runner.state();
                        state.runs.remove(&id);
                        if let Ok(credential) = &result {
                            state.credentials.insert(id, credential.clone());
                        }
                        let _ = sender.send(Some(result));
                    });
                    state.runs.insert(
                        cluster.to_string(),
                        Run {
                            result: receiver.clone(),
                            abort: task.abort_handle(),
                            group,
                        },
                    );
                    receiver
                }
            }
        };
        let outcome = receiver
            .wait_for(Option::is_some)
            .await
            .map_err(|_| "getting credentials: the plugin was stopped".to_string())?;
        outcome.clone().expect("waited for a result")
    }

    /// Drops the credential of `cluster`, as a `401` does: the next request
    /// runs the plugin again.
    pub fn invalidate(&self, cluster: &str) {
        self.state().credentials.remove(cluster);
    }

    /// Kills a run of `cluster` with its process group and drops its
    /// credential, as a disconnect does.
    pub fn stop(&self, cluster: &str) {
        let run = {
            let mut state = self.state();
            state.credentials.remove(cluster);
            state.runs.remove(cluster)
        };
        if let Some(run) = run {
            kill(&run);
        }
    }

    /// Kills every run, as quitting does.
    pub fn stop_all(&self) {
        let runs: Vec<Run> = {
            let mut state = self.state();
            state.credentials.clear();
            state.runs.drain().map(|(_, run)| run).collect()
        };
        for run in &runs {
            kill(run);
        }
    }
}

fn kill(run: &Run) {
    if let Some(pid) = *run.group.lock().expect("the group lock") {
        // SAFETY: a plain system call on a process group the core started.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    run.abort.abort();
}

/// The command of a plugin, as it is run: a path with `/` read against the
/// kubeconfig's folder, a bare name looked up on `path`.
pub fn resolve(command: &str, base_dir: &Path, path: &str) -> Option<PathBuf> {
    if command.contains('/') {
        let candidate = Path::new(command);
        return Some(if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            base_dir.join(candidate)
        });
    }
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(command))
        .find(|candidate| {
            use std::os::unix::fs::PermissionsExt;
            candidate
                .metadata()
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
}

/// `KUBERNETES_EXEC_INFO`: the `ExecCredential` the plugin reads.
pub fn exec_info(plugin: &Plugin) -> Value {
    let mut spec = json!({"interactive": false});
    if plugin.provide_cluster_info {
        spec["cluster"] = plugin.cluster_info.clone();
    }
    json!({"apiVersion": plugin.api_version, "kind": "ExecCredential", "spec": spec})
}

/// Reads the plugin's answer.
pub fn parse_credential(plugin: &Plugin, stdout: &[u8]) -> Result<Credential, String> {
    let answer: Value = serde_json::from_slice(stdout)
        .map_err(|error| format!("getting credentials: decoding stdout: {error}"))?;
    if let Some(version) = answer.get("apiVersion").and_then(Value::as_str)
        && version != plugin.api_version
    {
        return Err(format!(
            "getting credentials: exec plugin is configured to use API version {}, plugin returned version {version}",
            plugin.api_version
        ));
    }
    let status = answer.get("status").cloned().unwrap_or(Value::Null);
    let text = |name: &str| {
        status
            .get(name)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let client_tls = match (text("clientCertificateData"), text("clientKeyData")) {
        (Some(cert), Some(key)) => Some((cert, key)),
        _ => None,
    };
    let token = text("token");
    if token.is_none() && client_tls.is_none() {
        return Err(
            "getting credentials: exec: plugin did not return a token or a client certificate and key"
                .into(),
        );
    }
    let expires_at = match text("expirationTimestamp") {
        Some(expiry) => Some(expiry.parse::<Timestamp>().map_err(|error| {
            format!("getting credentials: exec: invalid expirationTimestamp: {error}")
        })?),
        None => None,
    };
    Ok(Credential {
        token,
        client_tls,
        expires_at,
    })
}

/// Runs the plugin once.
async fn run(
    plugin: &Plugin,
    shell: &ShellEnv,
    group: &Mutex<Option<i32>>,
    report: &(dyn Fn(&str) + Send + Sync),
) -> Result<Credential, String> {
    if plugin.interactive_mode.as_deref() == Some("Always") {
        return Err(
            "getting credentials: exec plugin cannot support interactive mode: standard input is not a terminal"
                .into(),
        );
    }
    // A plugin waits for the login shell's environment, up to its limit
    // (FR-035).
    let vars = shell.vars().await;
    let path = vars.get("PATH").map_or("", String::as_str);
    let Some(program) = resolve(&plugin.command, &plugin.base_dir, path) else {
        return Err(format!(
            "getting credentials: exec: executable {} not found",
            plugin.command
        ));
    };
    let mut env: HashMap<String, String> = (*vars).clone();
    for (name, value) in &plugin.env {
        env.insert(name.clone(), value.clone());
    }
    env.insert("KUBERNETES_EXEC_INFO".into(), exec_info(plugin).to_string());
    let mut command = tokio::process::Command::new(&program);
    command
        .args(&plugin.args)
        .env_clear()
        .envs(&env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // SAFETY: setsid is async-signal-safe; the plugin gets a process group of
    // its own, which a disconnect or quitting kills whole.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(|error| {
        format!(
            "getting credentials: exec: fork/exec {}: {error}",
            program.display()
        )
    })?;
    *group.lock().expect("the group lock") = child.id().map(|pid| pid as i32);
    let mut stdout = child.stdout.take().expect("a piped stdout");
    let mut stderr = child.stderr.take().expect("a piped stderr");
    let mut out = Vec::new();
    // Each chunk as it comes, for a prompt the plugin waits on.
    let read_err = async {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = stderr.read(&mut chunk).await {
            if read == 0 {
                break;
            }
            report(&String::from_utf8_lossy(&chunk[..read]));
        }
    };
    let (read_out, (), status) = tokio::join!(stdout.read_to_end(&mut out), read_err, child.wait());
    let _ = read_out;
    *group.lock().expect("the group lock") = None;
    let status = status.map_err(|error| format!("getting credentials: exec: {error}"))?;
    if !status.success() {
        let code = status.code().unwrap_or(-1);
        return Err(format!(
            "getting credentials: exec: executable {} failed with exit code {code}",
            plugin.command
        ));
    }
    parse_credential(plugin, &out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(command: &str) -> Plugin {
        Plugin {
            command: command.into(),
            args: Vec::new(),
            env: Vec::new(),
            api_version: "client.authentication.k8s.io/v1".into(),
            interactive_mode: Some("Never".into()),
            provide_cluster_info: false,
            base_dir: PathBuf::from("/kube"),
            cluster_info: json!({"server": "https://127.0.0.1:6443"}),
        }
    }

    #[test]
    fn a_command_with_a_slash_is_read_against_the_kubeconfig_folder() {
        assert_eq!(
            resolve("bin/plugin", Path::new("/kube"), ""),
            Some(PathBuf::from("/kube/bin/plugin"))
        );
        assert_eq!(
            resolve("/usr/local/bin/plugin", Path::new("/kube"), ""),
            Some(PathBuf::from("/usr/local/bin/plugin"))
        );
    }

    #[test]
    fn a_bare_command_is_looked_up_on_the_path_given() {
        assert_eq!(
            resolve("sh", Path::new("/kube"), "/nowhere:/bin"),
            Some(PathBuf::from("/bin/sh"))
        );
        assert_eq!(resolve("sh", Path::new("/kube"), "/nowhere"), None);
    }

    #[test]
    fn the_exec_info_has_the_cluster_only_when_asked() {
        let mut asked = plugin("p");
        assert_eq!(
            exec_info(&asked),
            json!({"apiVersion": "client.authentication.k8s.io/v1", "kind": "ExecCredential", "spec": {"interactive": false}})
        );
        asked.provide_cluster_info = true;
        assert_eq!(
            exec_info(&asked)["spec"]["cluster"],
            json!({"server": "https://127.0.0.1:6443"})
        );
    }

    #[test]
    fn a_credential_is_fresh_until_60_seconds_before_its_expiry() {
        let now: Timestamp = "2026-11-26T10:00:00Z".parse().unwrap();
        let expiring = |at: &str| Credential {
            token: Some("t".into()),
            client_tls: None,
            expires_at: Some(at.parse().unwrap()),
        };
        assert!(expiring("2026-11-26T10:01:01Z").is_fresh(now));
        assert!(!expiring("2026-11-26T10:01:00Z").is_fresh(now));
        assert!(!expiring("2026-11-26T09:00:00Z").is_fresh(now));
        let lasting = Credential {
            token: Some("t".into()),
            client_tls: None,
            expires_at: None,
        };
        assert!(lasting.is_fresh(now));
    }

    #[test]
    fn the_answer_gives_a_token_or_a_certificate_and_key() {
        let p = plugin("p");
        let token = parse_credential(
            &p,
            br#"{"apiVersion":"client.authentication.k8s.io/v1","kind":"ExecCredential","status":{"token":"x","expirationTimestamp":"2026-11-26T10:00:00Z"}}"#,
        )
        .unwrap();
        assert_eq!(token.token.as_deref(), Some("x"));
        assert!(token.expires_at.is_some());
        let tls = parse_credential(
            &p,
            br#"{"status":{"clientCertificateData":"C","clientKeyData":"K","token":"x"}}"#,
        )
        .unwrap();
        assert_eq!(tls.client_tls, Some(("C".into(), "K".into())));
        assert!(parse_credential(&p, br#"{"status":{}}"#).is_err());
        assert!(
            parse_credential(
                &p,
                br#"{"apiVersion":"client.authentication.k8s.io/v1beta1","status":{"token":"x"}}"#
            )
            .unwrap_err()
            .contains("plugin returned version client.authentication.k8s.io/v1beta1")
        );
        assert!(
            parse_credential(&p, b"not json")
                .unwrap_err()
                .starts_with("getting credentials: decoding stdout")
        );
    }

    // Runs of real plugin scripts (research R3)

    use crate::cluster::fake_api::{
        self, Plugin as Script, plugin_env, plugin_runs, temp_dir, write_plugin,
    };
    use crate::foundation::shell_env::Env;
    use std::time::Instant;

    fn shell_with_path(path: &str) -> ShellEnv {
        let mut env: Env = crate::foundation::shell_env::process_env();
        env.insert("PATH".into(), path.into());
        env.insert("FROM".into(), "shell".into());
        ShellEnv::ready(env)
    }

    fn plugin_in(dir: &Path, name: &str) -> Plugin {
        Plugin {
            base_dir: dir.to_path_buf(),
            ..plugin(name)
        }
    }

    fn in_a_minute(seconds: i64) -> String {
        Timestamp::now()
            .checked_add(SignedDuration::from_secs(seconds))
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn a_bare_command_is_found_on_the_shell_s_path_and_gets_its_environment() {
        let dir = temp_dir("exec-path");
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        write_plugin(
            &bin,
            "fake-login",
            &Script::Token {
                token: fake_api::EXEC_TOKEN.into(),
                expires: None,
            },
            None,
        );
        let mut p = plugin_in(&dir, "fake-login");
        p.env = vec![
            ("FROM".into(), "kubeconfig".into()),
            ("ONLY".into(), "k".into()),
        ];
        p.provide_cluster_info = true;
        let credential = Runner::default()
            .credential(
                "c1",
                &p,
                &shell_with_path(&format!("/usr/bin:/bin:{}", bin.display())),
            )
            .await
            .unwrap();
        assert_eq!(credential.token.as_deref(), Some(fake_api::EXEC_TOKEN));
        let env = plugin_env(&bin, "fake-login", 1);
        assert_eq!(env["FROM"], "kubeconfig");
        assert_eq!(env["ONLY"], "k");
        let info: Value = serde_json::from_str(&env["KUBERNETES_EXEC_INFO"]).unwrap();
        assert_eq!(info["spec"]["interactive"], false);
        assert_eq!(info["spec"]["cluster"]["server"], "https://127.0.0.1:6443");
        assert_eq!(info["apiVersion"], "client.authentication.k8s.io/v1");
    }

    #[tokio::test]
    async fn a_command_not_on_the_shell_s_path_is_not_found() {
        let dir = temp_dir("exec-missing");
        let error = Runner::default()
            .credential(
                "c1",
                &plugin_in(&dir, "fake-login"),
                &shell_with_path("/usr/bin:/bin"),
            )
            .await
            .unwrap_err();
        assert_eq!(
            error,
            "getting credentials: exec: executable fake-login not found"
        );
    }

    #[tokio::test]
    async fn a_failing_plugin_is_worded_as_client_go_words_it() {
        let dir = temp_dir("exec-fails");
        let path = write_plugin(
            &dir,
            "fake-login",
            &Script::Fail {
                code: 1,
                message: "no browser".into(),
            },
            None,
        );
        let error = Runner::default()
            .credential(
                "c1",
                &plugin_in(&dir, path.to_str().unwrap()),
                &shell_with_path("/usr/bin:/bin"),
            )
            .await
            .unwrap_err();
        assert_eq!(
            error,
            format!(
                "getting credentials: exec: executable {} failed with exit code 1",
                path.display()
            )
        );
    }

    #[tokio::test]
    async fn interactive_mode_always_fails_without_a_terminal() {
        let dir = temp_dir("exec-always");
        let mut p = plugin_in(&dir, "fake-login");
        p.interactive_mode = Some("Always".into());
        let error = Runner::default()
            .credential("c1", &p, &shell_with_path("/usr/bin:/bin"))
            .await
            .unwrap_err();
        assert!(error.contains("standard input is not a terminal"));
        assert_eq!(plugin_runs(&dir, "fake-login"), 0);
    }

    #[tokio::test]
    async fn a_client_certificate_and_key_are_returned() {
        let dir = temp_dir("exec-cert");
        let api = fake_api::FakeApi::start(fake_api::Tls::Server, &dir).await;
        let path = write_plugin(&dir, "cert-login", &Script::ClientCert, Some(&api));
        let credential = Runner::default()
            .credential(
                "c1",
                &plugin_in(&dir, path.to_str().unwrap()),
                &shell_with_path("/usr/bin:/bin"),
            )
            .await
            .unwrap();
        let (cert, key) = credential.client_tls.unwrap();
        assert!(cert.contains("BEGIN CERTIFICATE"));
        assert!(key.contains("PRIVATE KEY"));
    }

    #[tokio::test]
    async fn a_credential_is_reused_until_60_seconds_before_it_expires() {
        let dir = temp_dir("exec-expiry");
        let lasting = write_plugin(
            &dir,
            "lasting",
            &Script::Token {
                token: "t".into(),
                expires: Some(in_a_minute(600)),
            },
            None,
        );
        let runner = Runner::default();
        let shell = shell_with_path("/usr/bin:/bin");
        for _ in 0..3 {
            runner
                .credential("c1", &plugin_in(&dir, lasting.to_str().unwrap()), &shell)
                .await
                .unwrap();
        }
        assert_eq!(plugin_runs(&dir, "lasting"), 1);

        let expiring = write_plugin(
            &dir,
            "expiring",
            &Script::Token {
                token: "t".into(),
                expires: Some(in_a_minute(30)),
            },
            None,
        );
        for _ in 0..3 {
            runner
                .credential("c2", &plugin_in(&dir, expiring.to_str().unwrap()), &shell)
                .await
                .unwrap();
        }
        assert_eq!(plugin_runs(&dir, "expiring"), 3);
    }

    #[tokio::test]
    async fn one_without_expiry_is_reused_until_it_is_invalidated() {
        let dir = temp_dir("exec-invalidate");
        let path = write_plugin(
            &dir,
            "lasting",
            &Script::Token {
                token: "t".into(),
                expires: None,
            },
            None,
        );
        let runner = Runner::default();
        let shell = shell_with_path("/usr/bin:/bin");
        let p = plugin_in(&dir, path.to_str().unwrap());
        runner.credential("c1", &p, &shell).await.unwrap();
        runner.credential("c1", &p, &shell).await.unwrap();
        assert_eq!(plugin_runs(&dir, "lasting"), 1);
        runner.invalidate("c1");
        runner.credential("c1", &p, &shell).await.unwrap();
        assert_eq!(plugin_runs(&dir, "lasting"), 2);
    }

    #[tokio::test]
    async fn two_requests_during_a_run_share_it() {
        let dir = temp_dir("exec-shared");
        let path = write_plugin(
            &dir,
            "slow",
            &Script::Sleep {
                seconds: 1,
                token: "t".into(),
            },
            None,
        );
        let runner = Runner::default();
        let shell = shell_with_path("/usr/bin:/bin");
        let p = plugin_in(&dir, path.to_str().unwrap());
        let (a, b) = tokio::join!(
            runner.credential("c1", &p, &shell),
            runner.credential("c1", &p, &shell)
        );
        assert_eq!(a.unwrap().token, b.unwrap().token);
        assert_eq!(plugin_runs(&dir, "slow"), 1);
    }

    #[tokio::test]
    async fn stop_kills_a_run_with_its_process_group() {
        let dir = temp_dir("exec-stop");
        let pid_file = dir.join("child.pid");
        let path = dir.join("hanging");
        std::fs::write(
            &path,
            format!(
                "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n",
                pid_file.display()
            ),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let runner = Runner::default();
        let shell = shell_with_path("/usr/bin:/bin");
        let p = plugin_in(&dir, path.to_str().unwrap());
        let waiting = tokio::spawn({
            let runner = runner.clone();
            async move { runner.credential("c1", &p, &shell).await }
        });
        for _ in 0..200 {
            if pid_file.exists() && !std::fs::read_to_string(&pid_file).unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        runner.stop("c1");
        assert!(waiting.await.unwrap().is_err());
        let child: i32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        // SAFETY: signal 0 only asks whether the process exists.
        assert_ne!(
            unsafe { libc::kill(child, 0) },
            0,
            "the plugin's child was left running"
        );
    }

    #[tokio::test]
    async fn a_plugin_waits_for_the_shell_sync() {
        let dir = temp_dir("exec-waits");
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        write_plugin(
            &bin,
            "fake-login",
            &Script::Token {
                token: "t".into(),
                expires: None,
            },
            None,
        );
        let shell_script = dir.join("testshell");
        std::fs::write(
            &shell_script,
            format!(
                "#!/bin/sh\nsleep 0.5\nexport PATH={}:$PATH\neval \"$4\"\n",
                bin.display()
            ),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shell_script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let shell = ShellEnv::start_with(
            shell_script.to_string_lossy().into_owned(),
            [("PATH".to_string(), "/usr/bin:/bin".to_string())].into(),
            "en-US".into(),
            Duration::from_secs(10),
            std::sync::Arc::new(|_| {}),
        );
        let started = Instant::now();
        let credential = Runner::default()
            .credential("c1", &plugin_in(&dir, "fake-login"), &shell)
            .await
            .unwrap();
        assert_eq!(credential.token.as_deref(), Some("t"));
        assert!(started.elapsed() >= Duration::from_millis(400));
    }
}
