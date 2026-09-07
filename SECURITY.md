# Security Policy

## Supported versions

Only the latest minor release of the current major line receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"), which reaches the maintainer directly.

Include the affected version, a description of the issue, and a minimal reproduction if you have
one. You will get an acknowledgement within seven days. Fixes ship as a patch release with a GitHub
Security Advisory; reporters are credited unless they ask not to be.

## Scope

hono-ban renders error responses. Reports we care about most:

- server internals (stack traces, database detail, file paths) reaching a client response by default
- prototype pollution through user-supplied `meta` or extension members
- header injection through error headers
- denial of service through pathological error payloads
