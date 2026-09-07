---
'hono-ban': minor
---

Validate options at construction instead of producing broken responses.

- `problemDetails()` throws `TypeError` when `traceIdMember` names a reserved member (`status`,
  `id`, `errors`, ...) or is not an RFC 9457 extension member name; `jsonApi()` rejects a
  `traceIdMetaKey` the format writes itself (`stack`, `location`, `code`, ...) or that is not a
  JSON:API member name; `googleApi()` rejects a `traceIdMetadataKey` outside the
  `ErrorInfo.metadata` key grammar. Previously `traceIdMember: 'status'` replaced the numeric status
  with the trace id.
- `ban.onError()` throws `TypeError` when `errorIdHeader`, `requestIdHeader`, or `headers` holds a
  name or value `Headers` rejects. Previously the failure surfaced inside the handler's last-resort
  fallback and the handler rejected.
- `googleApi()` drops `meta` keys that do not match `[a-z][a-zA-Z0-9-_]+` or exceed 64 characters,
  as `error_details.proto` requires for `ErrorInfo.metadata`, and the 2020-12 schema states the rule
  with `propertyNames`. Keys such as `order.id` or `UserId` were previously sent as-is.
