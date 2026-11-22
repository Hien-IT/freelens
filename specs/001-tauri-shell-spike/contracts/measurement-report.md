# Contract: Measurement Report

`specs/001-tauri-shell-spike/measure.sh` produces the figures of FR-011, and
they are recorded in `specs/baseline.md`, in a section for the experimental
build next to the baseline.

## Script output

One line per run, `key=value` pairs, like `specs/measure-baseline.sh`:

```text
build=spike run=1 loaded=1 startup_s=<s> rss_mb=<MB> procs=<n> kube_refs=0
build=spike run=1 scenario=cluster namespaces_shown_s=<s> rss_mb=<MB> procs=<n>
```

- `namespaces_shown_s` is the time from `Mark "cluster-opened"` to
  `Mark "namespaces-shown"`, to the millisecond, taken by `mark-interval.py`,
  which reads the log as it is written.
- `rss_mb` sums the RSS of the main process and of every process whose
  responsible pid is the main process (research R7), in the unit of
  `specs/measure-baseline.sh`: the KiB of `ps` divided by 1024.
- Both builds are started with `open -n`, so that each is its own responsible
  process; `<app bundle or dmg>` may be a dmg, which the script mounts to copy
  the app from.
- `procs` counts those processes; the script also prints each one as
  `proc=<pid> <name> <rss_mb>` so that the kinds are visible.
- `kube_refs` counts `/.kube` in the log and must be 0 for idle runs with
  `--kubeconfig=none`.
- The script prints `dmg_bytes=` for the installer and `dmg_format=` from
  `hdiutil imageinfo`.

## Report in `specs/baseline.md`

| Figure                                      | Experimental build | Current build  | Gate   |
| ------------------------------------------- | ------------------ | -------------- | ------ |
| Installer (MB)                              | size of the dmg    | 211.8          | ≤ 85   |
| Startup, median of 3 (s)                    | median (3 runs)    | 2.37           | ≤ 2.37 |
| Idle RSS, median of 3 (MB)                  | median (3 runs)    | 788            | ≤ 394  |
| Processes at idle                           | count and kinds    | 4              | none   |
| Time to namespace list, median of 3 (s)     | median (3 runs)    | measured again | none   |
| RSS with the cluster open, median of 3 (MB) | median (3 runs)    | measured again | none   |

With the table, the report states:

- the dmg format, and which helper programs the installer bundles (kubectl,
  helm) and which it does not (freelens-k8s-proxy), as FR-013 requires;
- the JavaScript heap of the current build's root frame at idle, as the
  approximate memory the full UI adds to the experimental build (research R3),
  and its sum with the experimental build's idle RSS, which SC-008 compares
  with 394 MB;
- that the current build's figures were measured again with the
  responsible-pid method and match the baseline's process set, or how they
  differ;
- the go or no-go decision (SC-008).
