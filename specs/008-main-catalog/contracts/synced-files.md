# Contract: Syncs and Synced Files

FR-002 to FR-012; research R3 to R5. What the core does with each sync and
each synced file, and what a file gives the catalog.

## The syncs

In this order, which decides which sync keeps an id two syncs give:

1. `<data dir>/kubeconfigs`, created at startup when missing; always synced.
2. The keys of `preferences.syncKubeconfigEntries` of the user store, in the
   setting's order. When the setting is unset: the kube directory for a
   release build, nothing for a debug build (spec 007's model already applies
   this default).
3. The file of `--kubeconfig=<path>`, when given; never written to the setting.

A sync's path is normalized as chokidar normalizes it: every `\` becomes `/`,
then Node's `path.normalize` (which resolves `.` and `..` lexically and keeps
a trailing slash), then repeated slashes become one, keeping a leading `//`.
No `~` is expanded. A change of the key set starts the added syncs and stops
the removed ones; the application's directory never stops.

At start, a sync's path is stat'ed, following symbolic links: a folder is a
folder sync, anything else a file sync. A path that does not exist is
skipped with a debug line and not looked at again until the key set changes;
another stat error is a warning.

## The synced files

- A file sync has one synced file, the sync's path.
- A folder sync has one synced file per entry directly in the folder that is
  not a directory once symbolic links are followed, under the path
  `path.join(<folder>, <name>)`, unless the name matches an ignore rule:

  | Rule        | Names                                                                 |
  | ----------- | --------------------------------------------------------------------- |
  | exact       | `.DS_Store`, `Thumbs.db`, `cache`, `desktop.ini`, `kubectx`, `kubens` |
  | starts with | `._`, `.#`, `~`                                                       |
  | ends with   | `.bak`, `.lock`, `.swn`, `.swo`, `.swp`, `#`, `~`                     |

  An ignored file is logged once at info level with its rule.

## Following changes

FSEvents only wakes a scan of the syncs whose canonical watched paths contain
the event's path; a dropped or coalesced subtree scans every sync under it.
A scan stats each synced file and lists each folder:

| Seen by the scan                              | Result                                                        |
| --------------------------------------------- | ------------------------------------------------------------- |
| the first scan of a sync                      | each file read at once                                        |
| a new file, or a changed size, mtime or inode | read when the identity has not changed for 500 ms             |
| a file missing                                | removed if still missing 100 ms later; a change if it is back |
| a symbolic link                               | its target's canonical path is watched too                    |

## Reading

In this order; the first that fails decides.

1. **Size**: at least 32 MiB for a file sync, 2 MiB for a folder's file:
   `skipping <path>: size=<size> is larger than maxSize=<limit>`, warning; no
   cluster.
2. **Read**: an error is a warning `failed to read file: <error>`; the file's
   clusters stay as they were.
3. **Encoding**: `FF FE` UTF-16 LE, `FE FF` UTF-16 BE, else UTF-8; strict; the
   byte order mark dropped. Invalid text: `skipping <path>: <error>`, warning;
   no cluster.
4. **Loading**, below: a throw is `Failed to compute diff: <error>`, warning;
   no cluster.
5. **Split**: each context of the loaded config; one that fails validation is
   a debug line `context failed validation: <error>` and gives no cluster.

## Loading

The loader of `common/kube-helpers/main/kube-helpers.ts`:

1. Blank text is no document. Other text is YAML: duplicate keys are an
   error, merge keys are expanded, `true`/`false` are the only booleans,
   plain scalars that js-yaml's default schema reads as timestamps are not
   strings. A parse error throws `invalid YAML: <reason> at line <n>`, where
   `<reason>` is the core's own text and never quotes the file.
2. Schema, every unknown key allowed:

   | Path                                   | Rule                                                |
   | -------------------------------------- | --------------------------------------------------- |
   | (document)                             | an object                                           |
   | `users`, `clusters`, `contexts`        | optional; arrays                                    |
   | `users[i].name`                        | required string, not empty                          |
   | `clusters[i].name`                     | required string, not empty                          |
   | `clusters[i].cluster`                  | required object                                     |
   | `clusters[i].cluster.server`           | required string, not empty                          |
   | `contexts[i].name`                     | required string, not empty                          |
   | `contexts[i].context`                  | optional object                                     |
   | `contexts[i].context.cluster`, `.user` | required strings, not empty when `context` is there |
   | `current-context`                      | a string, not empty; `default` when it fails        |

   An entry of `users`, `clusters` or `contexts` that breaks a rule is dropped.
   The messages are Joi's: `"<path>" is required`, `"<path>" is not allowed to
   be empty`, `"<path>" must be a string`, `"<path>" must be of type object`,
   `"<path>" must be an array`; joined by `. ` they are the schema error,
   logged as `encountered errors while loading config: <error>`, warning,
   without the values.
3. The config is built from what is left: a context without `context` throws
   `contexts[<i>].context is missing`.
4. Split: per context in file order, its own context, cluster and user by
   name, the first of each name. Validation fails with `No valid context
   object provided in kubeconfig for context '<name>'`, or `cluster`, or
   `user`, when one is missing.

## Ids and labels

- Cluster id: MD5, lowercase hex, of `<synced file path>:<context name>`.
- An id is kept by the first sync, then the first file within it, that gives
  it.
- `file` label: when the synced file's path does not start with the string
  `<data dir>/kubeconfigs`, the path with the first occurrence of `$HOME`
  replaced by `~`.

## What is never logged

The text of a file, a value of a schema error, and a parser message built
from the text.
