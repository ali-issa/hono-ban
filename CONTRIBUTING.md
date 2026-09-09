# Contributing to hono-ban

Thanks for helping. This document covers setup, the quality gates, and how changes are released.
Design intent lives in `docs/DESIGN.md`, the normative contract in `docs/SPEC.md`, and decisions in
`docs/adr/`; read those before proposing API changes.

## Prerequisites

- Node.js 24 (see `.node-version`; Node 22.12+ is supported at runtime and in CI)
- pnpm 12 (`corepack enable` or `npm install -g pnpm@12`; the exact version is pinned in
  `package.json` `packageManager`)

## Setup

```bash
git clone https://github.com/ali-issa/hono-ban.git
cd hono-ban
pnpm install
```

`pnpm install` also installs the git hooks (lefthook): formatting and linting run on commit, types
and tests run on push. Run `pnpm build` once before `pnpm check`: the type-aware lint of `e2e/` and
the package checks (`publint`, `attw`) read `dist/`.

## Scripts

| Script                     | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `pnpm check`               | Runs every `check:*` script below, in order                     |
| `pnpm check:format`        | `oxfmt --check`                                                 |
| `pnpm check:lint`          | `oxlint` with type-aware rules                                  |
| `pnpm check:types`         | `tsc --noEmit`                                                  |
| `pnpm check:deps`          | `knip`: unused files, exports, dependencies                     |
| `pnpm check:pkg`           | `publint` and `arethetypeswrong` against the built package      |
| `pnpm test`                | Vitest, including type tests in `*.test-d.ts`                   |
| `pnpm test:coverage`       | Vitest with V8 coverage; thresholds are enforced                |
| `pnpm test:e2e`            | Build, then type-check and run `e2e/` against the built package |
| `pnpm test:runtimes`       | Build, then run the smoke test on Bun, Deno, and workerd        |
| `pnpm build`               | tsdown: ESM, declarations, updates `exports` in `package.json`  |
| `pnpm format` / `lint:fix` | Apply formatting / autofixable lint fixes                       |

CI runs the same commands. A pull request must be green on all of them.

## Conventions

- **Tests are colocated.** `foo.ts` has `foo.test.ts` next to it, and `foo.test-d.ts` when the types
  are part of the contract. New behavior ships with tests; bug fixes ship with a failing test first.
- **End-to-end tests live in `e2e/`.** That directory is a private pnpm workspace package that
  depends on `hono-ban` through `workspace:*`, so its imports resolve through the published
  `exports` map into `dist/` and its `tsc` run checks the emitted declarations. Each `*.e2e.test.ts`
  file starts a real Hono app on `@hono/node-server` and asserts over `fetch`. Never import from
  `src/` there. Run one file with `pnpm --filter hono-ban-e2e exec vitest run <name>` after
  `pnpm build`.
- **Runtime smoke tests live in `e2e/smoke/`.** One app imports every subpath; `run.ts` drives it
  in-process on Bun and Deno and `workerd.ts` bundles it with tsdown and runs it in Miniflare's
  workerd. `pnpm test:runtimes` needs `bun` and `deno` on your `PATH`; CI installs both.
- **Every non-obvious decision cites its source.** Add an `@ref <url>` comment pointing at the RFC,
  spec section, or upstream doc that justifies it. Reviewers should be able to verify a choice
  without re-researching it.
- **Never throw inside the error handler.** See ADR 0002. The handler returns a `Response` on every
  path.
- **Nothing reads `process.env` at module scope.** Behavior is configured through options so the
  package runs on workerd, Deno, Bun, and Node. See ADR 0004.
- **Files stay small and single-purpose.** One exported concept per file; split rather than add
  section dividers.
- **Type at boundaries, infer locally.** Exports carry explicit types (required by
  `isolatedDeclarations`); locals do not.
- **No `any`, no non-null assertions, `Array<T>` over `T[]`, `??` over `||`.** oxlint enforces
  these.
- **No emojis** in code, docs, or commit messages.
- **Lint disables carry a reason.** `// oxlint-disable-next-line rule -- reason: <why>`.

## Adding a format or adapter

The four extension points are wire formats (`src/formats/<name>/index.ts`, exported as
`hono-ban/formats/<name>`), validator hooks (`src/validation/<name>.ts`, exported as
`hono-ban/<name>`), observability sources (`src/observability/<name>.ts`, exported as
`hono-ban/<name>`), and database error mappers (`src/<database>/index.ts`, exported as
`hono-ban/<database>`; `hono-ban/postgresql` is the one so far). Formats are namespaced because
several ship and a consumer picks one; hooks, sources, and mappers are top-level because a consumer
picks the one matching a library already installed.

**What is accepted in-tree.** Open a discussion first (the issue templates link to it) so the scope
question is settled before code exists.

- A format must implement a published specification with a stable URL (RFC 9457, JSON:API 1.1, and
  Google's AIP-193 are the precedents), or a vendor error shape that meets all of: publicly
  documented with a machine-readable schema, unchanged for years, and copied by unrelated APIs
  (Stripe's `api_errors` object is the one admitted so far; ADR 0014 records the test). `plain()` is
  the one deliberate exception to both. A shape that exists in one organization belongs in that
  organization as a `defineFormat()` call, which the README shows.
- A validator hook must target a validator with its own `@hono/*` middleware that Standard Schema
  does not already cover. `hono-ban/standard-schema` serves every Standard Schema library (ArkType,
  Effect Schema, Zod 4, Valibot), so a dedicated hook for one of them needs a reason the shared hook
  cannot meet.
- An observability module supplies a request id or trace id source for `HandlerOptions`. Sinks
  (loggers, error trackers) are not adapters: `onReport` hands them the report directly, and
  `docs/DESIGN.md` section 4.6 rules out an adapter layer.
- A database error mapper keys on a documented, standardized error code space (Postgres SQLSTATE,
  Appendix A of its manual, is the precedent), never on message text, and produces constant
  client-facing text (ADR 0007, ADR 0015). It must recognize every mainstream driver's error shape
  structurally and unwrap the common ORM wrappers.

**Constraints every contribution inherits.**

- `hono` stays the only peer dependency. Type the third-party objects you read structurally (`*Like`
  interfaces) and never import the library at runtime or in types (ADR 0009). The real library is a
  devDependency in both `package.json` and `e2e/package.json`; pnpm refuses versions younger than a
  day (`minimumReleaseAge`). A database mapper's real driver is an `e2e/` devDependency (PGlite runs
  Postgres in-process and `@electric-sql/pglite-socket` serves it to real drivers over the wire
  protocol), and a driver whose error type spells its fields differently is a root devDependency for
  a type-level test only. The README's database-errors table and the matrix in ADR 0015 say how each
  driver is verified; moving a driver from fixtures to a live connection updates both.
- A format owns its JSON Schema as a literal and pins `status`, `code`, and `title` with
  `constant()` from `schema-helpers.ts` (ADR 0003, ADR 0011). It renders from `ctx.meta`, which is
  already sanitized, and derives `type` at render time (ADR 0010). A format cannot set response
  headers; those stay with the error and the handler (SPEC 6.9).
- A hook is `createHook(ban, extract)` from `validation/hook.ts` and throws `ban.validation()`; it
  never returns a `Response` (SPEC 8.4).

**Checklist.** Every item below is checked by CI or by a reviewer.

1. Source file in the location above, with a `@packageDocumentation` header naming the SPEC section
   it implements and `@ref` links to the specification or upstream source.
2. Entry in `tsdown.config.ts` (the key becomes the subpath). Run `pnpm build` and commit the
   regenerated `exports` in `package.json`; CI fails on a diff. knip reads the tsdown entries, so
   `knip.jsonc` needs no change.
3. Unit tests beside the file. Formats also run `assertFormatConformance()` from `src/testing` with
   the Ajv compiler in `src/test-support/ajv.ts`; hooks add a case to `validation/hooks.test-d.ts`
   proving assignability to the real middleware's hook type; mappers add a `*.test-d.ts` proving
   assignability to `BanOptions['map']` for bans with and without custom catalogs and to the real
   driver's error type.
4. `e2e/package-surface.e2e.test.ts`: the exact export list of the new subpath. An e2e file named
   `<area>-<subject>.e2e.test.ts` driving the subpath over real HTTP.
5. `e2e/smoke/app.ts` imports the subpath and `e2e/smoke/checks.ts` exercises it; the smoke test
   must pass on Bun, Deno, and workerd (`pnpm test:runtimes`).
6. Docs in the same PR: `docs/SPEC.md` sections 1 (subpath table and source layout), 12 (entry
   list), 14 and 14.1 (test rows), plus the section for the new module (6.x, 7.x, 8.x, or 10.x);
   `docs/DESIGN.md` section 4.4, 4.5, 4.7, or 4.6, and 4.10; the README Modules table and any
   sentence that enumerates the formats or hooks; `package.json` `keywords` when a new library name
   applies.
7. An ADR: a new subpath is a public API change, and a new format is a wire format.
8. A changeset: an additive subpath or option is `minor`; anything that changes an existing wire
   shape, schema, or exported type is `major`.

## Commits and pull requests

- Use conventional commit subjects: `feat(formats): add problem-details renderer`,
  `fix(handler): preserve HTTPException headers`. Types: `feat`, `fix`, `refactor`, `perf`, `test`,
  `docs`, `chore`, `build`, `ci`.
- Keep pull requests focused. Describe the why in the body; link the issue.
- Every user-visible change needs a changeset (next section). CI fails without one on `src/`
  changes.

## Changesets and releases

Releases are automated with [Changesets](https://github.com/changesets/changesets).

1. In your branch run `pnpm changeset` and pick `patch`, `minor`, or `major`. Write the entry for
   users, not for maintainers: what changed and what they have to do.
2. Commit the generated file under `.changeset/`.
3. When your PR merges, the release workflow opens or updates a "Version Packages" PR that bumps
   `package.json` and `CHANGELOG.md`.
4. Merging that PR publishes to npm through trusted publishing (OIDC, with provenance) and creates a
   GitHub release.

For a prerelease line, run `pnpm changeset pre enter <tag>` on `main` and commit the resulting
`.changeset/pre.json`; releases then publish under that npm dist-tag instead of `latest` until
`pnpm changeset pre exit` is committed.

## Architecture decisions

Anything that changes the public API, the wire format, the runtime support matrix, or a dependency
gets an ADR in `docs/adr/`. Copy `docs/adr/0000-template.md`, number it, and link it from the PR.

## Reporting bugs and requesting features

Use the issue templates. For security issues follow `SECURITY.md`; do not open a public issue.
