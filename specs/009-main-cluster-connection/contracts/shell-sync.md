# Contract: The Shell Sync

FR-033 to FR-035; research R4. Run once at startup by the core.

## The shell

The `shell` setting of the user store, else the user's login shell from the
system's user database, else `$SHELL`, else `zsh`.

| Base name of the shell             | Arguments                  | stdin       |
| ---------------------------------- | -------------------------- | ----------- |
| `fish`                             | `-l -c <command>`          | empty       |
| `csh`, `tcsh`                      | `-l`                       | `<command>` |
| `pwsh`, `pwsh-preview`             | `-Login -Command <script>` | empty       |
| any other (`zsh`, `bash`, `sh`, …) | `-l -i -c <command>`       | empty       |

- `<command>`: `printf '%s' <mark>; /usr/bin/env -0; printf '%s' <mark>`,
  `<mark>` 32 random hex characters.
- `<script>`: prints `<mark>`, the process environment as compact JSON, and
  `<mark>`, with nothing between them.
- The shell runs in a new session (`setsid`) and process group, with the core's
  environment plus `ITERM_SHELL_INTEGRATION_INSTALLED=1`,
  `TERM=screen-256color-bce` and `VSCODE_SHELL_INTEGRATION=1`.
- The core's environment is its process environment without `HTTPS_PROXY` and
  `HTTP_PROXY`; the first of them that is not empty becomes `APP_HTTPS_PROXY`,
  as the Electron build's `setup-proxy-env.injectable.ts` does before anything
  runs (research R2).

## The result

- The text between the two marks, split on NUL, each record on its first `=`;
  a record without `=` before its first character is skipped. pwsh's is the
  JSON object.
- The three variables added for the shell get back the core's values, or are
  removed if the core has none.
- Merge into the shell environment: `PATH` = the shell's entries then the
  core's, empty entries and repeats dropped, first one kept; for any other
  variable, the core's own value wins; `LANG`, when the shell gives none, is
  the first preferred language of macOS with its first `-` made `_` and
  `.UTF-8` appended, and `.UTF-8` is appended to one that lacks it.

## Failures

| Situation                                      | Error                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the shell cannot start                         | `Failed to spawn <path>: <JSON {error, stdout, stderr}, indented 4>`                                                                                                             |
| it exits with a code other than 0, or a signal | `Shell did not exit successfully: <JSON {code, signal, stdout, stderr}, indented 4>`                                                                                             |
| no marks in its output                         | `Something has blocked the shell from producing the environment variables`                                                                                                       |
| 30 s pass                                      | its process group killed with `SIGKILL`; `Resolving shell environment is taking very long. Please review your shell configuration: timeout: <JSON {stdout, stderr}, indented 4>` |

A failure is logged `[SHELL-SYNC]: <error>`, leaves the core's own environment
as the shell environment, and is sent on `shell-sync-failed-channel` to the main
window when its page first loads, once; the page shows `Failed to sync shell
environment: <error>`.

## Timing

The shell sync does not hold back the window or the catalog. A credential
plugin that starts before it ends waits for it, at most until its 30 s.
Neither the environment nor the shell's output is logged.
