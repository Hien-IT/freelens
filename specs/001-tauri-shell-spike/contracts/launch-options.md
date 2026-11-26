# Contract: Launch Options

The experimental build reads its options from the process arguments, once, at
launch.

| Option                          | Effect                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)                          | the catalog syncs what the settings name (spec 008)                                                                                                                                            |
| `--kubeconfig=<path>`           | also sync `<path>` for the run, never written to the settings; a relative path is resolved against the working directory                                                                       |
| `--kubeconfig=none`             | add nothing to the syncs of the settings                                                                                                                                                       |
| `--open-cluster=<context name>` | open that cluster as soon as the catalog is shown, as a click would; for measurement runs (FR-011)                                                                                             |
| `--data-dir=<path>`             | use `<path>` as the data directory instead of the Electron build's; for measurements and tests (spec 007, research R6)                                                                         |
| `--catalog-dump=<path>`         | append each catalog the core sends to `<path>`, one JSON line each, and have the page mark what it receives; for measurements and tests (spec 008, research R12)                               |
| `--scenario=lists`              | the pages run the scenario of `specs/baseline.md` themselves, mark each step with the wall clock, and disconnect the cluster 70 s after clicking it; for measurements (spec 009, research R15) |
| `--messages-dump=<path>`        | append every message the core sends to `<path>`, one JSON line each; for tests (spec 009, research R17)                                                                                        |

Rules:

- The `KUBECONFIG` environment variable is ignored.
- An unknown option, a `--scenario` other than `lists`, or `--kubeconfig`,
  `--open-cluster`, `--data-dir`, `--catalog-dump`, `--scenario` or
  `--messages-dump` without a value, prints a message that names it on
  standard error and exits with status 2 before any window opens.
- An `--open-cluster` name that is not a context of the file of
  `--kubeconfig` opens nothing.
- A path that does not exist is not an error at launch: the file adds no
  cluster, and the page shows a message that names it.

How to pass them:

```bash
"Freelens Spike.app/Contents/MacOS/freelens-spike" --kubeconfig=none
```

```bash
open -n -a "Freelens Spike" --args --kubeconfig=/path/to/kubeconfig.yaml
```

The binary name comes from `mainBinaryName` in `tauri.conf.json`. The
measurement runs start the binary directly, as the first form does.
