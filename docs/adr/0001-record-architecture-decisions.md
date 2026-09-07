# ADR 0001: Record architecture decisions

- Status: accepted
- Date: 2026-09-07

## Context

hono-ban 1.0 is a rewrite. Earlier choices in this problem space were made without a written
rationale, so later readers could not tell a decision from an accident, and the reasons were lost
with the code.

## Decision

Every decision that affects the public API, the wire format, the runtime support matrix, security
defaults, or dependencies is recorded as an ADR in `docs/adr/`, numbered sequentially, using
`0000-template.md`. A decision is changed by adding a new ADR that supersedes the old one, never by
editing history. Pull requests that make such a change link the ADR.

## Consequences

Reviewers can check code against a stated decision. Contributors have a place to argue a change
before writing it. The overhead is one short file per decision.
