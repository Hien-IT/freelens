# Contract: Store Files

The bytes the core reads and writes, so that the Electron build reads them
back unchanged (FR-005 to FR-008). Sources in research R1 and R2.

## A store file

- UTF-8, a JSON object, printed as `JSON.stringify(value, undefined, "\t")`
  prints it: one key per line, a tab per level, `": "` after a key, `{}` and
  `[]` for empty values, **no newline at the end**.
- Keys in the order JavaScript gives them: keys that are array indices
  (`"0"` to `"4294967294"`, written without leading zeros) first in ascending
  order, then the others in the order they were added.
- Numbers as JavaScript prints them; strings escaped as `JSON.stringify`
  escapes them.
- `__internal__` is a nested object, first in a file the core creates:

```text
{
	"__internal__": {
		"migrations": {
			"version": "0.1.0"
		}
	}
}
```

(Each level is one tab, and the file ends at the last `}`, without a newline.)

## Reading

| The file                                                 | The core                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| missing                                                  | writes the block above, model from defaults                                                                                                                                     |
| starts with a BOM                                        | strips it                                                                                                                                                                       |
| valid JSON, not an object                                | reads it as `{}`                                                                                                                                                                |
| empty, or invalid JSON                                   | copies it to `<config_name>.corrupt-<milliseconds since 1970>.json`, logs an error, writes the block above; if the copy fails, logs and keeps the file and the store unwritable |
| valid for JavaScript only (an unpaired surrogate escape) | logs, keeps the file, store unwritable for the run                                                                                                                              |
| unreadable (permission, I/O)                             | logs, keeps the file, store unwritable for the run                                                                                                                              |

`__internal__.migrations.version` is set to `0.1.0` when it is absent, not a
plain version, or lower than `0.1.0`; a higher one is kept. There is no
migration to run today; one the Electron build adds later is ported with it.

## Writing

1. Merge the model into the last file value (data-model.md, "Merging").
2. Print it as above.
3. Write `<file>.tmp-<10 digits><6 lowercase hex digits>` in the same
   directory, fsync it, give it the mode of the existing file (`0666` less the
   umask for a new one), rename it over the file.
4. On failure, remove the temporary file and log
   `error: Stores: cannot write <path>: <reason>`; the model stays as changed
   and is still sent to the views, as the Electron build does after a failed
   `set`.

A write never leaves a part of a file: the file is the old one or the new one.

## A local storage file

`JSON.stringify(state, null, 2)` followed by `\n`, mode `0600`, written the same
atomic way, in `lens-local-storage/` of mode `0700`.

## Fixtures

`freelens-tauri/src-tauri/tests/fixtures/data-dir/<case>/` holds, per case:

```text
input/<config_name>.json       # files as found (any may be absent)
change.json                    # { "<config_name>": <model a view sends> } applied after load
expected/models.json           # { "<config_name>": <model> } after load
expected/<config_name>.json    # bytes after load and the change
expected/corrupt/<config_name>.json  # the bytes of the .corrupt- copy, when one is expected
```

Both `tests/stores.rs` and
`packages/core/src/features/persistent-storage/main/tauri-parity.test.ts` run
every case whose name does not start with `core-only-`; those cases hold the
deliberate differences of research R3 and run in the cargo tests alone.
