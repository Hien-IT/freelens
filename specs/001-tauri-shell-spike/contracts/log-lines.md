# Contract: Log Lines

The core prints these lines on standard output, one per event, so that the
measurement script can time them as `specs/measure-baseline.sh` times
`"first-application-window" loaded` in the current build.

| Line                   | When                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Window "main" loaded` | the main webview's page load reaches its finished state, once per launch                                                                  |
| `Mark "<name>"`        | the core answers `GET /api/mark?name=<name>`; `<name>` matches `[a-z0-9-]{1,40}`, otherwise the request gets `400` and nothing is printed |

Marks the spike UI sends:

| Name               | Sent by                                                  |
| ------------------ | -------------------------------------------------------- |
| `catalog-shown`    | the main window, after the catalog list is in the page   |
| `cluster-opened`   | the main window, when it creates the iframe of a cluster |
| `namespaces-shown` | a cluster frame, after its namespace list is in the page |

The lines carry no path, cluster address or credential. Other log output may
appear between them; the script matches the exact text above.
