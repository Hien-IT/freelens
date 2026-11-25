# Contract: One Build per Data Directory

FR-023, research R5. Both builds follow this; the Electron build only reads.

## The links

| Link                           | Written by                        | Target             |
| ------------------------------ | --------------------------------- | ------------------ |
| `<data dir>/SingletonLock`     | Chromium, in every Electron build | `<hostname>-<pid>` |
| `<data dir>/FreelensTauriLock` | the Tauri build                   | `<hostname>-<pid>` |

A link is **live** when its target parses as `<hostname>-<pid>` (the pid is
the part after the last `-`) and either the hostname is not this host's, or
`kill(pid, 0)` succeeds or fails with `EPERM`. A target that does not parse
is not live.

## The Tauri build, before it reads or writes the data directory

1. Create the data directory if it is missing.
2. Create `FreelensTauriLock` with `symlink(2)`.
   - On `EEXIST`: if the existing link is live, refuse (step 4) naming the
     Tauri build; else remove it and create it again, once; a second
     `EEXIST` refuses.
3. If `SingletonLock` is live, remove `FreelensTauriLock` and refuse naming
   the Electron build.
4. Refusing: log `error: Instance: <build> runs on <data dir> (<link> -> <target>)`,
   show an `NSAlert` on the main thread, and exit with status 1 without
   writing anything else.
5. On exit, remove `FreelensTauriLock` if its target is still this process.

The alert:

- Message: `Freelens is already running`
- Informative text: `The <Electron|Tauri> build of Freelens is using <data dir>. Quit it, then start this one again. If it is not running, delete <link path>.`

## The Electron build, in `enforce-single-application-instance`

After `requestSingleInstanceLock()` returns true, and only then:

1. Read `<userData>/FreelensTauriLock` with `readlinkSync`; a missing link or
   any error reading it means no Tauri build.
2. If it is live (same rule, `process.kill(pid, 0)`), call the existing
   `showErrorPopup` with the title `Freelens is already running` and the text
   `The Tauri build of Freelens is using <userData>. Quit it, then start this one again. If it is not running, delete <link path>.`,
   then `forceAppExit()`.

When `requestSingleInstanceLock()` returns false, the Electron build exits as
before, silently; the new check does not run.

## Cases the tests cover

| Case                                                     | Tauri build              | Electron build                            |
| -------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| no link                                                  | starts, creates its link | starts                                    |
| live `SingletonLock`                                     | refuses, writes nothing  | (its own lock: exits silently, as before) |
| `SingletonLock` of a dead pid                            | starts                   | —                                         |
| live `FreelensTauriLock`                                 | refuses                  | refuses with the error box                |
| `FreelensTauriLock` of a dead pid                        | replaces it, starts      | starts                                    |
| link of another host                                     | refuses                  | refuses                                   |
| target that does not parse                               | replaces it, starts      | starts                                    |
| two data directories (e.g. `Freelens` and `FreelensDev`) | both start               | both start                                |
