# Contract: Launch Options

The experimental build reads its options from the process arguments, once, at
launch.

| Option                          | Effect                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| (none)                          | read `$HOME/.kube/config`                                                                          |
| `--kubeconfig=<path>`           | read `<path>` instead; a relative path is resolved against the working directory                   |
| `--kubeconfig=none`             | read no kubeconfig file; the catalog is empty                                                      |
| `--open-cluster=<context name>` | open that cluster as soon as the catalog is shown, as a click would; for measurement runs (FR-011) |

Rules:

- The `KUBECONFIG` environment variable is ignored.
- An unknown option, or `--kubeconfig` or `--open-cluster` without a value,
  prints a message that names it on standard error and exits with status 2
  before any window opens.
- An `--open-cluster` name that is not a context of the file in effect opens
  nothing.
- A path that does not exist is not an error at launch: the catalog is empty
  and shows a message that names the file.

How to pass them:

```bash
"Freelens Spike.app/Contents/MacOS/freelens-spike" --kubeconfig=none
```

```bash
open -n -a "Freelens Spike" --args --kubeconfig=/path/to/kubeconfig.yaml
```

The binary name comes from `mainBinaryName` in `tauri.conf.json`. The
measurement runs start the binary directly, as the first form does.
