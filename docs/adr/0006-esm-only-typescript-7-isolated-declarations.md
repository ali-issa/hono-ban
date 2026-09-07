# ADR 0006: ESM only, TypeScript 7, isolatedDeclarations, erasable syntax

- Status: accepted
- Date: 2026-09-07

## Context

Node 20 reached end of life in April 2026; Node 22.12+ and 24 load ESM from CommonJS through
`require(esm)`, which removes the last reason to ship a CJS build. TypeScript 7.0 ships the native
compiler as `tsc` but does not yet expose a programmatic API, so declaration emit must not depend on
it. Node's type stripping rejects enums, namespaces, and parameter properties. @ref
https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ @ref
https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require @ref
https://nodejs.org/api/typescript.html#type-stripping @ref https://tsdown.dev/options/dts

## Decision

The package publishes ESM only (`"type": "module"`, `exports` with `.js` and sibling `.d.ts`). The
build is tsdown with `platform: 'neutral'`; declarations are emitted by oxc from
`isolatedDeclarations: true`, which requires explicit types on every export. `erasableSyntaxOnly` is
on. `engines.node` is `>=22.12.0`. `publint` and `arethetypeswrong` run in the build and in CI;
`attw` uses the `esm-only` profile so the missing CJS resolution is not reported.

## Consequences

Every exported function and class member carries an explicit type annotation. There is no `enum`;
catalogs are `as const` objects. CommonJS consumers on Node 22.12+ can `require()` the package;
older CommonJS consumers cannot use it.
