# Quickstart: Main Foundation

How to show that the feature works. Every step uses a temporary data
directory: never the user's own `~/Library/Application Support/Freelens`.
Scratch files go under `$TMPDIR`.

## Prerequisites

- The development machine of `specs/baseline.md` (macOS on Apple Silicon).
- `mise install`, `pnpm install`, and the Electron binary
  (`node freelens/node_modules/electron/install.js` or `pnpm dev` once).
- `pnpm build`, for the Electron build and the renderer bundle the Tauri build
  stages.

## 1. Electron probe (before the paths are encoded)

Confirms the macOS values of `getPath` that research R6 marks Unverified.
Write `$TMPDIR/probe/package.json` with the name the packaged Electron build
has, since `logs` follows the application's name at the time of the call:

```json
{ "name": "freelens", "productName": "Freelens", "main": "main.cjs" }
```

and `$TMPDIR/probe/main.cjs`:

```js
const { app } = require("electron");
const names = [
  "home",
  "appData",
  "userData",
  "sessionData",
  "temp",
  "exe",
  "module",
  "desktop",
  "documents",
  "downloads",
  "music",
  "pictures",
  "videos",
  "logs",
  "crashDumps",
  "recent",
];
// A temporary appData, as an integration-testing run sets it: Chromium writes
// under userData once its paths are read, and the user's own must stay untouched.
app.setPath(
  "appData",
  require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "probe-")),
);
app.setPath("userData", require("node:path").join(app.getPath("appData"), "Freelens"));
app.setPath("sessionData", app.getPath("userData"));
const out = {};
for (const name of names) {
  try {
    out[name] = app.getPath(name);
  } catch (e) {
    out[name] = `THROWS ${e.message}`;
  }
}
console.log(JSON.stringify(out, null, 2));
app.exit(0);
```

Run it from the repository, so that the project's Electron runs it:

```bash
cd freelens && pnpm exec electron "$TMPDIR/probe"
```

Expected: a value per name; `recent` throws. Copy the values into the table of
[contracts/foundation-channels.md](./contracts/foundation-channels.md#app-paths)
and into the expected values of the core's `paths.rs` tests, with the home
directory as a placeholder.

## 2. Tests

```bash
cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: `tests/stores.rs`, `tests/foundation.rs`, `tests/instance.rs` and the
unit tests of `src/stores/` and `src/foundation/` pass; every case of
`tests/fixtures/data-dir/` is run.

````bash
TZ=UTC pnpm exec vitest run -c vitest.config.ts packages/core/src/features/persistent-storage/main/tauri-parity.test.ts packages/core/src/main/electron-app/runnables/enforce-single-application-instance.test.ts```

Expected: the Electron build's own store code and `conf` give the models and
the bytes of every shared fixture, the `core-only-` cases skipped; the lock
check exits with the error box only when the Tauri link is live.

Then the Electron build's own gates: `pnpm build:di`, `pnpm type:check`,
`pnpm test`, the integration tests, `pnpm knip:check`, `trunk check`.

## 3. Round trip with the Electron build (SC-001, SC-002)

Set up a data directory the Electron build writes, under the temporary
directory so both builds accept it:

```bash
export FREELENS_INTEGRATION_TESTING_DIR="$(mktemp -d "$TMPDIR/foundation.XXXXXX")"
````

1. Start the Electron build with that variable (the packaged app of
   `pnpm build:app:dir`, or `pnpm dev`, which uses `FreelensDev`). Change
   preferences away from their defaults (theme, proxy, terminal font, kubectl
   path, sync entries), add a second hotbar, pin two items, add a favorite and
   a web link, add a cluster from a test kubeconfig. Quit.
2. Copy the data directory aside (`cp -R`), as the control.
3. Start the Tauri build with the same variable and a matching build
   (`pnpm tauri:dev` for `FreelensDev`). In the Web Inspector of the main
   window, request `persistent-storage-initial-values` through the page's
   messaging and compare each model with what the Electron build shows in its
   preferences, hotbar and catalog. Send a changed model of the user store
   (one preference) and of the hotbar store (rename a hotbar). Quit.
4. `diff -r` the data directory with the control: only the two changed values
   differ, plus a `.tmp-` file never remains.
5. Start the Electron build again: it shows both changes, its log has no
   `.corrupt-` copy and no reset.

Repeat steps 1, 2 and 5 on `main`, without the Tauri build, as the control:
the Electron build reads its own files the same way.

## 4. A broken and a newer file (SC-003)

With the data directory of step 3:

- Replace `lens-hotbar-store.json` with `{` and start the Tauri build: a
  `lens-hotbar-store.corrupt-<ms>.json` holds `{`, the store starts from the
  `Default` hotbar, the other stores are unchanged.
- Set `__internal__.migrations.version` of `lens-user-store.json` to `9.0.0`
  and add `"futureSetting": 1` under `preferences` and at the top level; change
  one preference from the Tauri build: both keys and `9.0.0` remain.
- Interrupt a write: `kill -9` the Tauri build while a view sends changes in a
  loop; the file left loads in both builds.

## 5. One build per data directory (SC-008)

With the variable of step 3 set in each shell:

1. Start the Electron build, then the Tauri build: the Tauri build shows the
   alert naming the Electron build and the data directory, exits, and the
   data directory is unchanged (`ls -l` before and after, no
   `FreelensTauriLock`).
2. Quit the Electron build, start the Tauri build, then the Electron build:
   the Electron build shows the error box naming the Tauri build and exits;
   the Tauri build keeps running.
3. `kill -9` the Tauri build, then start the Electron build: it starts
   (the link's pid is gone).
4. Start a released Electron build (one without the check) while the Tauri
   build runs: it is not stopped, which is the documented limit; start them
   the other way round: the Tauri build refuses (`SingletonLock`).
5. Unset the variable for one of the two builds: both start, on different
   data directories.

## 6. Templates and download

- Start the Tauri build with the variable of step 3 and a home with
  `~/.freelens/templates` empty under the integration-testing home
  (`$FREELENS_INTEGRATION_TESTING_DIR/<appName>/home/.freelens/templates`).
  Ask for the templates from the page: `[]`. Add `a/x.yaml` and `y.json`: an
  update arrives within 2 seconds with groups `a` and `ungrouped`.
- Ask `download-json-channel` for `https://charts.helm.sh/stable/index.yaml`
  → an error from the parser (not JSON), for a JSON URL → its content, with
  `httpsProxy` set to `ftp://x` → the unsupported-scheme error.

## 7. Startup (SC-006)

Seed a data directory with the five stores of step 3 and measure as spec 001
does, the script copying the seed into a fresh temporary directory for each
run and passing it with `--data-dir`:

```bash
MEASURE_DATA_DIR="<seed directory>" specs/001-tauri-shell-spike/measure.sh spike <app bundle or dmg> 3 60
```

Expected: median startup at most 2.37 s. `measure.sh` gains the
`MEASURE_DATA_DIR` variable in this feature; without it, it measures as
before.

## 8. Channel list

Each main-foundation row of
`specs/002-messaging-for-tauri/contracts/channel-list.md` names the core's
module that answers it, and a cargo test shows each answer (SC-004).
