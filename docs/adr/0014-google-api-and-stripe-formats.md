# ADR 0014: Google API (AIP-193) and Stripe error formats in-tree; the vendor-shape acceptance test

- Status: accepted
- Date: 2026-09-07

## Context

After RFC 9457, JSON:API, and the plain shape, the question was which other error envelopes are
common enough to ship as built-in formats rather than as `defineFormat()` examples. The candidates
were surveyed against two questions: is there a normative, stable, machine-readable description of
the shape, and do APIs outside the originating organization use it.

- Google's AIP-193 defines the HTTP/1.1+JSON representation of `google.rpc.Status` used by every
  Google API and by gRPC transcoding gateways. The shape is normative (AIP-193, `status.proto`,
  `error_details.proto`, `code.proto`), and the HTTP-to-status mapping has a canonical
  implementation in Google's client library (gax-nodejs `HttpCodeToRpcCodeMap`).
- Stripe's `error` object is a vendor convention, not a specification. It is documented at a stable
  URL, described in Stripe's published OpenAPI document (`components.schemas.api_errors`), unchanged
  in its core members for over a decade, and copied by unrelated commercial APIs. `CONTRIBUTING.md`
  said formats need a published specification, which excluded it.
- Microsoft's OData error object and SCIM's RFC 7644 error schema meet the specification test but
  had no demand at the time; JSON-RPC, GraphQL, Connect, and Smithy describe protocol-level errors
  that do not map onto an HTTP status per error and were ruled out.

@ref https://google.aip.dev/193 @ref
https://github.com/googleapis/googleapis/blob/master/google/rpc/status.proto @ref
https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto @ref
https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto @ref
https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts @ref
https://docs.stripe.com/api/errors @ref
https://github.com/stripe/openapi/blob/master/openapi/spec3.json @ref
https://github.com/stripe/stripe-node/blob/master/src/Error.ts

## Decision

Two formats ship as subpaths, `hono-ban/formats/google-api` (`googleApi(options)`, SPEC 7.6) and
`hono-ban/formats/stripe` (`stripe(options?)`, SPEC 7.7), and the acceptance policy in
`CONTRIBUTING.md` gains a second admission route: a vendor shape that is publicly documented with a
machine-readable schema, has been unchanged for years, and is copied by unrelated APIs. Stripe is
the one shape admitted under it; a shape that exists in one organization still stays in that
organization as a `defineFormat()` call.

Google API format:

- `domain` is a required option. AIP-193 requires `ErrorInfo` in every error and requires `domain`
  to be globally unique; there is no value the library could derive that satisfies that.
- `status` resolves from `rpcCodes[code]`, else the catalog code when it names a `google.rpc.Code`,
  else the HTTP status through the gax-nodejs table (400 `INVALID_ARGUMENT`, 409 `ABORTED`, 416
  `OUT_OF_RANGE`, other 4xx `FAILED_PRECONDITION`, other 5xx `INTERNAL`). The mapping is
  many-to-one, so a library default cannot be right for every entry; the option settles the rest per
  code.
- `RequestInfo.requestId` carries the error id, so the body, the `X-Error-Id` header, and the report
  stay coherent (SPEC 10.2). `RetryInfo` mirrors a delay-seconds `Retry-After`. `Help` is emitted
  only for an absolute URL because AIP-193 requires one. `metadata` values are stringified because
  `ErrorInfo.metadata` is `map<string, string>`. `LocalizedMessage` is not emitted; `transform` is
  the localization point (SPEC 6.2).

Stripe format:

- `type` is classified the way Stripe's own SDK classifies raw errors (`generateV1Error`): 402
  `card_error`, other 4xx `invalid_request_error`, everything else `api_error`, with a per-code
  `types` override. On 2026-09-07 an unauthenticated `GET https://api.stripe.com/v1/customers/x`
  answered 401 with `{"error":{"message":"...","type":"invalid_request_error"}}` and
  `content-type: application/json`, confirming both the classification and the alphabetical member
  order the format reproduces.
- `code` is the catalog code lower-cased, Stripe's spelling. `param` is the first validation issue's
  path in the `deepObject` bracket notation Stripe's form-encoded requests use; Stripe reports one
  problem per response, so the remaining issues are dropped.
- The shape has no member for `meta`, the trace id, the stack, or the error id. The format does not
  invent one: the id travels in `X-Error-Id`, and the `requestLogUrl` option fills Stripe's own
  `request_log_url` slot for applications that link the id to a log viewer.

## Consequences

- The comparison with single-format libraries widens by two rows, and a team fronting a Google-style
  or Stripe-style API keeps the typed catalog, the report hook, the schema-derived OpenAPI, and the
  runtime matrix without writing a format.
- Choosing `stripe()` gives up the in-body id and `meta` that every other format carries; SPEC 7.7
  and the README say so. Choosing `googleApi()` requires naming a domain and, for entries whose HTTP
  status maps to the wrong code, an `rpcCodes` entry.
- The vendor-shape route is deliberately narrow. Admitting a second vendor shape needs the same
  three-part evidence recorded in a new ADR.
- ADR 0013's note that an in-tree OAuth 2.0 format needs a superseding ADR still stands; this ADR
  does not add one.
