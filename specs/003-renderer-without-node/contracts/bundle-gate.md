# Contract: The Renderer Bundle Gate

A check in the renderer build that no module of the renderer graph imports a
Node builtin or `electron` (research R2). It covers what the type check cannot
see: workspace packages outside `freelens/src` and `packages/core/src`, and npm
packages.

## Where

`runtimeRequireExternalsPlugin` in `freelens/electron.vite.config.ts`, applied to
the renderer build and to its worker build, as it is today. It already resolves
every builtin and `electron`. `resolveId(id, importer)` gives the importer, and
Rolldown's `this.getModuleInfo(id)` gives `importers` and `dynamicImporters`.

## Phase 1: list mode (from research R12, step 2)

1. During a build, for each import of a builtin (`fs`, `node:fs`, …) or of
   `electron`/`electron/*`, record the importer.
2. In `buildEnd`, walk each importer's `importers` and `dynamicImporters` up to
   the entry, and take the **first workspace module** on the way: the first
   module outside `node_modules`.
3. Compare those modules with the `rendererBundle` list of
   `scripts/type-check-environments/legacy.jsonc`:
   - a module that is not on the list fails the build;
   - a listed module that no longer brings any Node in also fails the build,
     until it is removed from the list, as the other legacy lists do.
4. The error has one line per offender, with the chain:

   ```text
   renderer bundle imports Node: node:fs
     <- node_modules/conf/dist/source/index.js
     <- packages/core/src/common/get-configuration-file-model/get-configuration-file-model.injectable.ts  (not on the rendererBundle list)
     <- … <- freelens/src/renderer/index.html
   ```

The shims stay in this phase, so the application still runs while the list
shrinks.

Type-only imports are erased before resolution and do not count [inferred: no
shim appears for `type-narrowing.ts`, whose builtin imports are type-only].

## Phase 2: no Node (research R12, step 11)

- The `rendererBundle` list is empty and is removed from `legacy.jsonc`, with
  the comment that describes it.
- The plugin stops emitting shims. Any builtin or `electron` import in the
  renderer graph fails the build, with the chain, and does so in development as
  well as in a production build.
- Vite's own browser stubs for builtins (`__vite-browser-external`) are refused
  as well, so that a builtin is never silently replaced by an empty module.

## What the gate does not cover

- Node globals in npm code (`process`, `Buffer`, `global`, `setImmediate`),
  which need no import. The integration tests with Node off, and the SC-002
  test, cover them at runtime.
- The workspace sources' globals, which the renderer type-check program covers.

## Tests

The plugin's walk and its two failure kinds have a unit test on a small module
graph, so that a broken gate cannot pass silently.
