# Freelens Constitution

This constitution states the rules a Spec Kit plan for Freelens is checked
against. It names each rule and links to the document that defines it; the
linked documents are authoritative and carry the detail. The agent guide is
[`AGENTS.md`](../../AGENTS.md).

## Core Principles

### I. Dependency Injection with Explicit Registration

- Application code is wired through `@ogre-tools/injectable`. A feature lives
  in its own directory under `packages/core/src/features/`, split by process
  into `common/`, `main/` and `renderer/`.
- Every file named `*.injectable.ts` or `*.injectable.tsx` is registered by
  generated `register-injectables.ts` files. A change that adds, moves or
  renames an injectable, or changes the directory structure around one, MUST
  run `pnpm build:di`. Generated registration files MUST NOT be edited by hand.

Rationale and detail: "Dependency Injection System" in `AGENTS.md` and "When to
regenerate DI files" in [`DEVELOPMENT.md`](../../DEVELOPMENT.md).

### II. Runtime Environment Boundaries

- Every source file belongs to the main process (Node, Electron), the renderer
  (a browser page) or both, decided by the `main/`, `renderer/` and `common/`
  context segments of its path. New code MUST go under a context directory.
- Renderer and common code MUST NOT import Node builtins or use Node globals.
  Common code uses only what both environments have.
- The legacy lists of `scripts/type-check-environments/legacy.jsonc` and the
  matching Biome exemptions MUST only shrink; no file is added to them to make
  a new error pass.
- A value the renderer shows about what main does (a default shell, a path, the
  environment) MUST come from main over a request channel.
- Test-only modules (`vitest`, `@testing-library/*`, `react-dom/test-utils`,
  the `act` import of `react`) MUST NOT be imported by production code.

`pnpm type:check` is the gate. Detail: "Runtime Environments in Type-Checking"
and "Before Opening a Pull Request" in `AGENTS.md`.

### III. The Extension API Is a Public Contract

- Whatever the `Common`, `Main` and `Renderer` namespaces reach is public and
  stable for the lifetime of a major release. A breaking change to it MUST ship
  only in a major release; a new member is an addition to the contract and MUST
  be deliberate.
- A plan that changes what such a function returns, or how it compares, orders
  or fails, MUST say whether the change belongs in the API or in a function of
  the core of its own.
- The host MUST stay the single instance of React, mobx and monaco. A class
  exported through the API MUST NOT be re-exported type-only.
- A change under `packages/extensions/` or `packages/core/src/extensions/` MUST
  be checked against the contracts first.

Contracts: [`docs/extensions/api.md`](../../docs/extensions/api.md) (C1 to
C15, in particular C3, C5 and C14),
[`docs/extensions/binaries.md`](../../docs/extensions/binaries.md) and
[`docs/extensions/migrating-from-v1.md`](../../docs/extensions/migrating-from-v1.md);
the traps are listed under "Extension API" in `AGENTS.md`. The same section
lists the sections of these documents that the `freelens` plugin skills cite by
name; that list MUST stay complete.

### IV. Styling by Role

Each of the four styling systems has one role, and new code MUST use the one
its context calls for:

- theme values through CSS custom properties (`var(--…)`);
- shared components in `packages/ui-components`, and anything an extension may
  restyle: a global PascalCase class with plain SCSS, no Tailwind and no CSS
  Modules;
- core single components and full views: CSS Modules (`*.module.scss`);
- local layout inside core-only TSX: Tailwind utilities. The removed
  `flexbox.scss` utilities MUST NOT come back.

Detail: [`docs/styling.md`](../../docs/styling.md) and
[`docs/themes.md`](../../docs/themes.md).

### V. Verified Changes

- Behaviour changes come with tests. Test code imports what it uses from
  `vitest`; no tsconfig declares the Vitest globals.
- A change MUST pass the checks that cover it: `pnpm type:check`,
  `pnpm test:unit` and, where they cover the change, `pnpm test:integration`,
  `pnpm biome check` through the pinned Biome of the root `package.json`,
  `trunk check`, and `pnpm knip:check` after `pnpm build`.
- A plan MUST also cover the surroundings of the change: comparators that are
  consistent for every value, views that keep unsaved edits when a watch
  delivers a new object, and a check in the running application that tries the
  empty value, the missing field and a change in the cluster while the view is
  open, with the same steps repeated on `main` as a control.

Detail: "Before Opening a Pull Request", "Knip" and "Best Practices" in
`AGENTS.md`, and "Running tests" in `DEVELOPMENT.md`.

### VI. Secrets and Supply Chain

- Secrets files (`.env`, `.env.*`, `.envrc`, `.npmrc`, keys and keystores) MUST
  NOT be read, displayed or included anywhere. The list lives in three places
  that change together: "Security" in `AGENTS.md`, `.gitignore` and the
  `permissions.deny` rules of `.claude/settings.json`. The rules stay native
  permissions; no hook that runs code from the working tree is added for them.
- Bundled and downloaded binaries are pinned by digest. A version bump MUST
  regenerate its pins (`pnpm update-binaries-lock`, or
  `pnpm update-kubectl-checksums` for the downloaded kubectl versions) rather
  than relax the verification.

Detail: "Security", "Bundled Binary Versions" and "Downloaded kubectl Versions"
in `AGENTS.md`.

## Repository Conventions

- **Source headers.** A new file gets the single-line Freelens header; a file
  that continues code from the OpenLens fork keeps the two-line one. Which one
  applies, and how to tell, is defined in `AGENTS.md`. Legal and license text
  and vendored third-party notices are not touched.
- **JSON.** Comments belong in `.jsonc`, never in `.json`.
- **Documentation.** `docs/`, the READMEs and `AGENTS.md` state the current
  rule or fact, without issue or pull-request numbers, dates, counts that go
  stale, or the history of how it got there ("Volatile Facts in Documentation"
  in `AGENTS.md`). Content from a feature spec that should outlive the feature
  moves there and follows that rule.
- **Working tree.** Scratch files and tool output go outside the repository.
  Changes are staged file by file after reviewing `git status`, never with
  `git add -A` or `git add .`.
- **GitHub comments.** A comment written on GitHub that merely refers to the
  Claude handle escapes it as `@<!-- -->claude`, so it does not start a CI run
  ("Local Agent: Triggering the GitHub Agent" in `AGENTS.md`).

## Spec-Driven Workflow

- Feature artifacts live under `specs/`. Each plan's Constitution Check answers,
  for the change it plans: which process each new or changed file runs in
  (Principle II); whether it adds or moves injectables (I); whether it touches
  what the extension API reaches (III); which styling system it uses (IV); and
  which checks and tests prove it (V).
- A deviation from a principle is recorded in the plan's Complexity Tracking
  with the reason and the simpler alternative that was rejected; otherwise the
  plan conforms.
- The files under `.specify/`, except this constitution, and the
  `.claude/skills/speckit-*` skills are managed by the Specify CLI and are
  excluded from Biome and Trunk. They change through `specify` commands, or
  through a project-local override in `.specify/templates/overrides/`, not by
  editing them in place.
- Spec Kit's agent event handlers stay disabled, so that it adds no hooks to
  `.claude/settings.json`.

## Governance

- `AGENTS.md` and the documents linked here are authoritative. When this
  constitution and one of them disagree, the linked document wins and this
  constitution is amended to match.
- Amendments go through `/speckit-constitution` and a reviewed pull request.
  The version follows semantic versioning: MAJOR for removing or redefining a
  principle, MINOR for adding a principle or section or materially expanding
  one, PATCH for clarifications.
- `/speckit-plan` checks each plan against this constitution, and
  `/speckit-analyze` checks the spec, plan and tasks for consistency with it.
  Reviewers check the same principles in the pull request.

**Version**: 1.0.0 | **Ratified**: 2026-11-22 | **Last Amended**: 2026-11-22
