/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The shell sync (`specs/009-main-cluster-connection/contracts/shell-sync.md`,
//! research R4): the environment of the user's login shell, taken once at
//! startup as the Electron build's `features/shell-sync` takes it, for the
//! credential plugins and, later, kubectl, helm and the terminals. The core's
//! own process environment is never changed.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch;

use crate::messaging::{Log, MessageChannel, QueueEvent, Sender, View};

/// An environment, as Node's `process.env` holds one.
pub type Env = HashMap<String, String>;

/// How long the shell may take (`compute-shell-environment.injectable.ts`).
pub const LIMIT: Duration = Duration::from_secs(30);

/// `shellSyncFailedChannel` of `features/shell-sync/common/failure-channel.ts`.
pub const SHELL_SYNC_FAILED: MessageChannel<String> =
    MessageChannel::new("shell-sync-failed-channel");

/// The variables the shell gets so that its integrations stay quiet, reset in
/// the result (`compute-unix-shell-environment.injectable.ts`).
pub const OVERRIDES: [(&str, &str); 3] = [
    ("ITERM_SHELL_INTEGRATION_INSTALLED", "1"),
    ("TERM", "screen-256color-bce"),
    ("VSCODE_SHELL_INTEGRATION", "1"),
];

/// The kind of a shell, by its base name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Posix,
    Fish,
    Csh,
    Pwsh,
}

pub fn kind(shell: &str) -> ShellKind {
    let name = Path::new(shell)
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    match name {
        "pwsh" | "pwsh-preview" => ShellKind::Pwsh,
        "fish" => ShellKind::Fish,
        "csh" | "tcsh" => ShellKind::Csh,
        _ => ShellKind::Posix,
    }
}

/// How the shell is run: its arguments and what it reads on stdin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub kind: ShellKind,
    pub args: Vec<String>,
    pub stdin: String,
}

pub fn invocation(shell: &str, mark: &str) -> Invocation {
    let command = format!("printf '%s' {mark}; /usr/bin/env -0; printf '%s' {mark}");
    let kind = kind(shell);
    let (args, stdin) = match kind {
        ShellKind::Posix => (vec!["-l", "-i", "-c", &command], String::new()),
        ShellKind::Fish => (vec!["-l", "-c", &command], String::new()),
        ShellKind::Csh => (vec!["-l"], command.clone()),
        // No Node ships with the Tauri build: PowerShell prints its own
        // environment as JSON between the marks (research R4).
        ShellKind::Pwsh => {
            let script = format!(
                "$e = @{{}}; Get-ChildItem env: | ForEach-Object {{ $e[$_.Name] = $_.Value }}; \
                 [Console]::Out.Write('{mark}' + ($e | ConvertTo-Json -Compress) + '{mark}')"
            );
            return Invocation {
                kind,
                args: vec!["-Login".into(), "-Command".into(), script],
                stdin: String::new(),
            };
        }
    };
    Invocation {
        kind,
        args: args.into_iter().map(str::to_string).collect(),
        stdin,
    }
}

/// The shell's environment from its output, between the two marks.
pub fn parse(kind: ShellKind, stdout: &str, mark: &str) -> Result<Env, String> {
    const BLOCKED: &str =
        "Something has blocked the shell from producing the environment variables";
    let start = stdout.find(mark).ok_or(BLOCKED)?;
    let end = stdout.rfind(mark).ok_or(BLOCKED)?;
    if end <= start {
        return Err(BLOCKED.into());
    }
    let inside = &stdout[start + mark.len()..end];
    if kind == ShellKind::Pwsh {
        let object: serde_json::Map<String, Value> =
            serde_json::from_str(inside).map_err(|error| error.to_string())?;
        return Ok(object
            .into_iter()
            .filter_map(|(name, value)| Some((name, value.as_str()?.to_string())))
            .collect());
    }
    Ok(inside
        .split('\0')
        .filter_map(|record| {
            let (name, value) = record.split_once('=')?;
            (!name.is_empty()).then(|| (name.to_string(), value.to_string()))
        })
        .collect())
}

/// Gives the variables of [`OVERRIDES`] back the core's values, or removes
/// them where the core has none.
pub fn reset_overrides(env: &mut Env, core: &Env) {
    for (name, _) in OVERRIDES {
        match core.get(name) {
            Some(value) => env.insert(name.to_string(), value.clone()),
            None => env.remove(name),
        };
    }
}

/// `PATH`s joined, each entry once, the first kept, empty ones dropped
/// (`union-env-path.ts`).
pub fn union_paths(paths: &[&str]) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for entry in paths.iter().flat_map(|path| path.split(':')) {
        if !entry.is_empty() && !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    seen.join(":")
}

/// The shell's environment merged into the core's, as `setup-shell` merges
/// it: the shell's `PATH` first, the core's own value of every other
/// variable winning, and `LANG` made UTF-8.
pub fn merge(mut shell: Env, core: &Env, locale: &str) -> Env {
    match shell.get("LANG") {
        None => {
            shell.insert(
                "LANG".into(),
                format!("{}.UTF-8", locale.replacen('-', "_", 1)),
            );
        }
        Some(lang) if !lang.ends_with(".UTF-8") => {
            let lang = format!("{lang}.UTF-8");
            shell.insert("LANG".into(), lang);
        }
        Some(_) => {}
    }
    let path = union_paths(&[
        shell.get("PATH").map_or("", String::as_str),
        core.get("PATH").map_or("", String::as_str),
    ]);
    let mut merged = shell;
    merged.extend(
        core.iter()
            .map(|(name, value)| (name.clone(), value.clone())),
    );
    merged.insert("PATH".into(), path);
    merged
}

fn pretty<T: Serialize>(value: &T) -> String {
    let mut out = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, formatter);
    value
        .serialize(&mut serializer)
        .expect("JSON of plain values");
    String::from_utf8(out).expect("JSON is UTF-8")
}

pub fn spawn_failure(shell: &str, error: &str, stdout: &str, stderr: &str) -> String {
    format!(
        "Failed to spawn {shell}: {}",
        pretty(&json!({"error": {"message": error}, "stdout": stdout, "stderr": stderr}))
    )
}

pub fn exit_failure(code: Option<i32>, signal: Option<&str>, stdout: &str, stderr: &str) -> String {
    format!(
        "Shell did not exit successfully: {}",
        pretty(&json!({"code": code, "signal": signal, "stdout": stdout, "stderr": stderr}))
    )
}

pub fn timeout_failure(stdout: &str, stderr: &str) -> String {
    format!(
        "Resolving shell environment is taking very long. Please review your shell configuration: timeout: {}",
        pretty(&json!({"stdout": stdout, "stderr": stderr}))
    )
}

fn signal_name(signal: i32) -> String {
    match signal {
        libc::SIGHUP => "SIGHUP",
        libc::SIGINT => "SIGINT",
        libc::SIGKILL => "SIGKILL",
        libc::SIGTERM => "SIGTERM",
        libc::SIGSEGV => "SIGSEGV",
        libc::SIGABRT => "SIGABRT",
        _ => return format!("signal {signal}"),
    }
    .to_string()
}

/// A random mark of 32 hexadecimal characters.
fn new_mark() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Runs the shell and gives its environment, or the failure's text.
async fn compute(
    shell: &str,
    core: &Env,
    limit: Duration,
    group: &Mutex<Option<i32>>,
) -> Result<Env, String> {
    let mark = new_mark();
    let call = invocation(shell, &mark);
    let mut env = core.clone();
    for (name, value) in OVERRIDES {
        env.insert(name.into(), value.into());
    }
    let mut command = tokio::process::Command::new(shell);
    command
        .args(&call.args)
        .env_clear()
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // SAFETY: setsid is async-signal-safe; the shell gets a session and a
    // process group of its own, with no controlling terminal, as Node's
    // `detached` gives it.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut child = command
        .spawn()
        .map_err(|error| spawn_failure(shell, &error.to_string(), "", ""))?;
    let pid = child.id().map(|pid| pid as i32);
    *group.lock().expect("the shell lock") = pid;

    let mut stdin = child.stdin.take().expect("a piped stdin");
    let mut stdout = child.stdout.take().expect("a piped stdout");
    let mut stderr = child.stderr.take().expect("a piped stderr");
    let out: Arc<Mutex<Vec<u8>>> = Arc::default();
    let err: Arc<Mutex<Vec<u8>>> = Arc::default();
    let (out_sink, err_sink) = (Arc::clone(&out), Arc::clone(&err));
    let reading = tokio::spawn(async move {
        let read_out = async {
            let mut chunk = [0u8; 8192];
            while let Ok(read) = stdout.read(&mut chunk).await {
                if read == 0 {
                    break;
                }
                out_sink
                    .lock()
                    .expect("the output lock")
                    .extend_from_slice(&chunk[..read]);
            }
        };
        let read_err = async {
            let mut chunk = [0u8; 8192];
            while let Ok(read) = stderr.read(&mut chunk).await {
                if read == 0 {
                    break;
                }
                err_sink
                    .lock()
                    .expect("the output lock")
                    .extend_from_slice(&chunk[..read]);
            }
        };
        tokio::join!(read_out, read_err);
    });
    let _ = stdin.write_all(call.stdin.as_bytes()).await;
    drop(stdin);

    let text = |buffer: &Arc<Mutex<Vec<u8>>>| {
        String::from_utf8_lossy(&buffer.lock().expect("the output lock")).into_owned()
    };
    let status = match tokio::time::timeout(limit, child.wait()).await {
        Ok(status) => status,
        Err(_) => {
            kill_group(pid);
            let _ = child.wait().await;
            reading.abort();
            *group.lock().expect("the shell lock") = None;
            return Err(timeout_failure(&text(&out), &text(&err)));
        }
    };
    let _ = reading.await;
    *group.lock().expect("the shell lock") = None;
    let (stdout, stderr) = (text(&out), text(&err));
    let status =
        status.map_err(|error| spawn_failure(shell, &error.to_string(), &stdout, &stderr))?;
    if !status.success() {
        use std::os::unix::process::ExitStatusExt;
        let signal = status.signal().map(signal_name);
        return Err(exit_failure(
            status.code(),
            signal.as_deref(),
            &stdout,
            &stderr,
        ));
    }
    let mut parsed = parse(call.kind, &stdout, &mark)?;
    reset_overrides(&mut parsed, core);
    Ok(parsed)
}

/// Kills the process group of `pid`, ignoring one already gone.
fn kill_group(pid: Option<i32>) {
    if let Some(pid) = pid {
        // SAFETY: a plain system call on a process group the core started.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

/// The login shell of the user database, as `os.userInfo().shell` reads it.
pub fn user_shell() -> Option<String> {
    // SAFETY: as `user_home` of `foundation::paths`.
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
        if status == 0 && !found.is_null() && !entry.pw_shell.is_null() {
            let shell = std::ffi::CStr::from_ptr(entry.pw_shell).to_string_lossy();
            return (!shell.is_empty()).then(|| shell.into_owned());
        }
    }
    None
}

/// The shell to run: the `shell` setting, else the user's login shell, else
/// `$SHELL`, else `zsh`.
pub fn shell_of(setting: Option<&str>) -> String {
    setting
        .filter(|shell| !shell.is_empty())
        .map(str::to_string)
        .or_else(user_shell)
        .or_else(|| {
            std::env::var("SHELL")
                .ok()
                .filter(|shell| !shell.is_empty())
        })
        .unwrap_or_else(|| "zsh".into())
}

/// The first preferred language of macOS, as Chromium's locale reads it.
pub fn locale() -> String {
    #[cfg(target_os = "macos")]
    {
        let languages = objc2_foundation::NSLocale::preferredLanguages();
        if let Some(first) = languages.iter().next() {
            return first.to_string();
        }
    }
    "en-US".into()
}

/// The core's own environment, without its own proxy.
pub fn process_env() -> Env {
    without_proxy(std::env::vars().collect())
}

/// `setup-proxy-env.injectable.ts` of the Electron build: `HTTPS_PROXY`, else
/// `HTTP_PROXY`, moves to `APP_HTTPS_PROXY` before anything runs, so a
/// cluster's proxy comes only from the login shell or its settings.
fn without_proxy(mut env: Env) -> Env {
    let https = env.remove("HTTPS_PROXY").filter(|value| !value.is_empty());
    let http = env.remove("HTTP_PROXY").filter(|value| !value.is_empty());
    if let Some(proxy) = https.or(http) {
        env.insert("APP_HTTPS_PROXY".into(), proxy);
    }
    env
}

struct Inner {
    vars: watch::Sender<Option<Arc<Env>>>,
    failure: Mutex<Option<String>>,
    group: Mutex<Option<i32>>,
    main_loaded: AtomicBool,
    sender: Mutex<Option<Sender>>,
}

/// The login shell's environment, shared and read-only
/// (contracts/clusters-api.md).
#[derive(Clone)]
pub struct ShellEnv {
    inner: Arc<Inner>,
}

impl ShellEnv {
    fn with(vars: Option<Arc<Env>>) -> Self {
        Self {
            inner: Arc::new(Inner {
                vars: watch::channel(vars).0,
                failure: Mutex::new(None),
                group: Mutex::new(None),
                main_loaded: AtomicBool::new(false),
                sender: Mutex::new(None),
            }),
        }
    }

    /// An environment known at once, with no shell run: for tests, and until
    /// the core's own shell sync is started.
    pub fn ready(vars: Env) -> Self {
        Self::with(Some(Arc::new(vars)))
    }

    /// Starts the shell sync on the async runtime and returns at once.
    pub fn start(setting: Option<&str>, log: Log) -> Self {
        Self::start_with(shell_of(setting), process_env(), locale(), LIMIT, log)
    }

    /// `start` with the shell, the core's environment, the locale and the
    /// limit given, for tests.
    pub fn start_with(shell: String, core: Env, locale: String, limit: Duration, log: Log) -> Self {
        let shell_env = Self::with(None);
        let running = shell_env.clone();
        tokio::spawn(async move {
            log("🐚 Syncing shell environment");
            let merged = match compute(&shell, &core, limit, &running.inner.group).await {
                Ok(env) => {
                    log("[SHELL-SYNC]: Synced shell env");
                    merge(env, &core, &locale)
                }
                Err(error) => {
                    log(&format!("[SHELL-SYNC]: {error}"));
                    *running.inner.failure.lock().expect("the failure lock") = Some(error);
                    running.deliver_failure();
                    core
                }
            };
            let _ = running.inner.vars.send(Some(Arc::new(merged)));
        });
        shell_env
    }

    /// The merged environment, once the shell sync has ended or given up.
    pub async fn vars(&self) -> Arc<Env> {
        let mut receiver = self.inner.vars.subscribe();
        let vars = receiver
            .wait_for(Option::is_some)
            .await
            .expect("the sender lives as long as the shell environment");
        Arc::clone(vars.as_ref().expect("waited for a value"))
    }

    /// The failure, taken once, for `shell-sync-failed-channel`.
    pub fn take_failure(&self) -> Option<String> {
        self.inner.failure.lock().expect("the failure lock").take()
    }

    /// Kills the shell if it still runs.
    pub fn stop(&self) {
        kill_group(*self.inner.group.lock().expect("the shell lock"));
    }

    /// Sends the failure to the main window once its page has loaded, as the
    /// Electron build sends it once the root frame has rendered: on the first
    /// page load after the failure, once.
    pub fn deliver_failures(&self, sender: &Sender) {
        *self.inner.sender.lock().expect("the sender lock") = Some(sender.clone());
        let opening = self.clone();
        sender.on_queue_opened(move |view| {
            if *view == View::Main {
                opening.inner.main_loaded.store(true, Ordering::SeqCst);
                opening.deliver_failure();
            }
        });
        let following = self.clone();
        sender.on_queue_event(move |event| {
            if let QueueEvent::Restarted(View::Main) = event {
                following.inner.main_loaded.store(true, Ordering::SeqCst);
                following.deliver_failure();
            }
        });
    }

    fn deliver_failure(&self) {
        if !self.inner.main_loaded.load(Ordering::SeqCst) {
            return;
        }
        let sender = self.inner.sender.lock().expect("the sender lock").clone();
        if let Some(sender) = sender
            && let Some(failure) = self.take_failure()
        {
            sender.send_to(&View::Main, SHELL_SYNC_FAILED, &failure);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARK: &str = "deadfoobarfoobeef";
    const COMMAND: &str =
        "printf '%s' deadfoobarfoobeef; /usr/bin/env -0; printf '%s' deadfoobarfoobeef";

    #[test]
    fn the_core_s_own_proxy_moves_to_app_https_proxy() {
        let env = |pairs: &[(&str, &str)]| -> Env {
            pairs
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect()
        };
        let moved = without_proxy(env(&[
            ("HTTPS_PROXY", "http://s:1"),
            ("HTTP_PROXY", "http://p:1"),
            ("https_proxy", "http://lower:1"),
        ]));
        assert_eq!(
            moved,
            env(&[
                ("APP_HTTPS_PROXY", "http://s:1"),
                ("https_proxy", "http://lower:1"),
            ])
        );
        assert_eq!(
            without_proxy(env(&[("HTTPS_PROXY", ""), ("HTTP_PROXY", "http://p:1")])),
            env(&[("APP_HTTPS_PROXY", "http://p:1")])
        );
        assert_eq!(
            without_proxy(env(&[("HTTPS_PROXY", ""), ("APP_HTTPS_PROXY", "kept")])),
            env(&[("APP_HTTPS_PROXY", "kept")])
        );
    }

    // pc/features/shell-sync/main/compute-unix-shell-environment.test.ts

    #[test]
    fn csh_and_tcsh_get_the_command_on_stdin() {
        for shell in ["/bin/csh", "/bin/tcsh", "/usr/local/bin/TCSH.exe"] {
            let call = invocation(shell, MARK);
            assert_eq!(call.kind, ShellKind::Csh, "{shell}");
            assert_eq!(call.args, ["-l"]);
            assert_eq!(call.stdin, COMMAND);
        }
    }

    #[test]
    fn bash_sh_and_zsh_are_login_and_interactive_with_nothing_on_stdin() {
        for shell in [
            "/bin/bash",
            "/bin/sh",
            "/bin/zsh",
            "zsh",
            "/opt/homebrew/bin/nu",
        ] {
            let call = invocation(shell, MARK);
            assert_eq!(call.kind, ShellKind::Posix, "{shell}");
            assert_eq!(call.args, ["-l", "-i", "-c", COMMAND]);
            assert_eq!(call.stdin, "");
        }
    }

    #[test]
    fn fish_is_login_with_nothing_on_stdin() {
        let call = invocation("/opt/homebrew/bin/fish", MARK);
        assert_eq!(call.kind, ShellKind::Fish);
        assert_eq!(call.args, ["-l", "-c", COMMAND]);
        assert_eq!(call.stdin, "");
    }

    #[test]
    fn pwsh_prints_its_environment_as_json_between_the_marks() {
        for shell in ["/usr/local/bin/pwsh", "/usr/local/bin/pwsh-preview"] {
            let call = invocation(shell, MARK);
            assert_eq!(call.kind, ShellKind::Pwsh, "{shell}");
            assert_eq!(call.args[..2], ["-Login", "-Command"]);
            assert!(call.args[2].contains("ConvertTo-Json -Compress"));
            assert_eq!(call.args[2].matches(MARK).count(), 2);
            assert_eq!(call.stdin, "");
        }
        let env = parse(
            ShellKind::Pwsh,
            &format!("noise{MARK}{{\"PATH\":\"/a:/b\",\"N\":\"1\"}}{MARK}"),
            MARK,
        )
        .unwrap();
        assert_eq!(env["PATH"], "/a:/b");
        assert_eq!(env["N"], "1");
        // No variable of the Electron build's Node script.
        assert!(!call_has_electron_flags(&invocation("pwsh", MARK)));
    }

    fn call_has_electron_flags(call: &Invocation) -> bool {
        call.args.iter().any(|arg| arg.contains("ELECTRON_"))
    }

    #[test]
    fn the_overrides_are_reset_to_the_core_s_values_or_removed() {
        let core: Env = [("TERM", "some-other-value"), ("SOME_ENV_VAR", "x")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let mut env: Env = OVERRIDES
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .chain([("SHELL_ONLY".to_string(), "y".to_string())])
            .collect();
        reset_overrides(&mut env, &core);
        assert_eq!(env["TERM"], "some-other-value");
        assert!(!env.contains_key("ITERM_SHELL_INTEGRATION_INSTALLED"));
        assert!(!env.contains_key("VSCODE_SHELL_INTEGRATION"));
        assert_eq!(env["SHELL_ONLY"], "y");
    }

    #[test]
    fn the_output_is_parsed_between_the_marks() {
        let out = format!(
            "rc noise\n{MARK}A=1\0MULTI=line one\nline two\0EQ=a=b=c\0BASH_FUNC_greet%%=() {{ echo hi\n}}\0NOEQUALS\0=leading\0{MARK}more noise"
        );
        let env = parse(ShellKind::Posix, &out, MARK).unwrap();
        assert_eq!(env["A"], "1");
        assert_eq!(env["MULTI"], "line one\nline two");
        assert_eq!(env["EQ"], "a=b=c");
        assert_eq!(env["BASH_FUNC_greet%%"], "() { echo hi\n}");
        assert!(!env.contains_key("NOEQUALS"));
        assert!(!env.contains_key(""));
        assert_eq!(env.len(), 4);
    }

    #[test]
    fn missing_marks_are_the_blocked_error() {
        for out in ["", "no marks here", &format!("only one {MARK}")] {
            assert_eq!(
                parse(ShellKind::Posix, out, MARK),
                Err(
                    "Something has blocked the shell from producing the environment variables"
                        .into()
                ),
                "{out}"
            );
        }
    }

    #[test]
    fn the_failures_are_worded_as_the_electron_build_words_them() {
        assert_eq!(
            exit_failure(Some(1), None, "", "boom"),
            "Shell did not exit successfully: {\n    \"code\": 1,\n    \"signal\": null,\n    \"stdout\": \"\",\n    \"stderr\": \"boom\"\n}"
        );
        assert!(exit_failure(None, Some("SIGKILL"), "", "").contains("\"signal\": \"SIGKILL\""));
        assert!(
            spawn_failure("/no/shell", "No such file", "", "")
                .starts_with("Failed to spawn /no/shell: {\n    ")
        );
        assert_eq!(
            timeout_failure("", ""),
            "Resolving shell environment is taking very long. Please review your shell configuration: timeout: {\n    \"stdout\": \"\",\n    \"stderr\": \"\"\n}"
        );
    }

    #[test]
    fn a_mark_is_32_hexadecimal_characters() {
        let mark = new_mark();
        assert_eq!(mark.len(), 32);
        assert!(mark.bytes().all(|b| b.is_ascii_hexdigit()));
    }

    // pc/features/shell-sync/main/union-env-path.test.ts

    #[test]
    fn one_path_is_unchanged() {
        assert_eq!(union_paths(&["/a:/b"]), "/a:/b");
    }

    #[test]
    fn doubled_separators_are_collapsed() {
        assert_eq!(union_paths(&["/a::/b"]), "/a:/b");
    }

    #[test]
    fn repeats_are_removed_and_new_entries_appended_in_order() {
        assert_eq!(union_paths(&["/a:/b", "/b:/c:/a"]), "/a:/b:/c");
        assert_eq!(union_paths(&["/a", "/b:/a", "/c:/b:/d"]), "/a:/b:/c:/d");
    }

    // The merge of setup-shell.injectable.ts

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn the_shell_s_path_comes_first_and_the_core_s_values_win() {
        let shell = env(&[
            ("PATH", "/opt/homebrew/bin:/usr/bin"),
            ("GOPATH", "/go"),
            ("HOME", "/shell"),
        ]);
        let core = env(&[("PATH", "/usr/bin:/bin"), ("HOME", "/core")]);
        let merged = merge(shell, &core, "en-US");
        assert_eq!(merged["PATH"], "/opt/homebrew/bin:/usr/bin:/bin");
        assert_eq!(merged["GOPATH"], "/go");
        assert_eq!(merged["HOME"], "/core");
    }

    #[test]
    fn lang_is_made_utf_8() {
        assert_eq!(merge(env(&[]), &env(&[]), "vi-VN")["LANG"], "vi_VN.UTF-8");
        assert_eq!(
            merge(env(&[]), &env(&[]), "zh-Hans-CN")["LANG"],
            "zh_Hans-CN.UTF-8"
        );
        assert_eq!(
            merge(env(&[("LANG", "en_GB")]), &env(&[]), "vi-VN")["LANG"],
            "en_GB.UTF-8"
        );
        assert_eq!(
            merge(env(&[("LANG", "de_DE.UTF-8")]), &env(&[]), "vi-VN")["LANG"],
            "de_DE.UTF-8"
        );
        // The core's own LANG wins, as in the Electron build.
        assert_eq!(
            merge(env(&[("LANG", "de_DE")]), &env(&[("LANG", "C")]), "vi-VN")["LANG"],
            "C"
        );
    }

    #[test]
    fn the_shell_is_the_setting_then_the_user_s() {
        assert_eq!(shell_of(Some("/bin/fish")), "/bin/fish");
        let default = shell_of(None);
        assert!(!default.is_empty());
        assert_eq!(shell_of(Some("")), default);
    }
}
