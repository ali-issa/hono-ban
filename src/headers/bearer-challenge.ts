/**
 * `WWW-Authenticate: Bearer ...` challenge builder (SPEC 3.2). A 401 MUST
 * carry a challenge (RFC 9110 15.5.2) and RFC 6750 fixes the grammar of every
 * Bearer attribute, so each value is checked against its character class and
 * a value taken from a request cannot break the header or smuggle a second
 * attribute. `hono/bearer-auth` emits the same shape.
 * @ref https://www.rfc-editor.org/rfc/rfc6750#section-3
 * @ref https://www.rfc-editor.org/rfc/rfc6749#appendix-A
 * @ref https://www.rfc-editor.org/rfc/rfc9728#section-5.1
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-11.2
 * @packageDocumentation
 */

export interface BearerChallengeOptions {
  /**
   * Protection space (RFC 9110 11.5). Printable ASCII; double quotes and
   * backslashes are escaped as a quoted-pair. When no attribute at all is
   * given the challenge is `Bearer realm=""`, as `hono/bearer-auth` sends,
   * because RFC 6750 requires at least one attribute.
   */
  readonly realm?: string | undefined;
  /**
   * Scopes the resource requires, joined by single spaces on the wire. Each
   * token is RFC 6749 `scope-token`; an empty list omits the attribute.
   */
  readonly scope?: string | ReadonlyArray<string> | undefined;
  /**
   * `invalid_request` (400), `invalid_token` (401), `insufficient_scope`
   * (403), or an extension code such as RFC 9470 `insufficient_user_authentication`.
   * RFC 6750 3.1 says to omit it when the request carried no token at all.
   */
  readonly error?: string | undefined;
  /** Developer-facing explanation, not meant for end users. */
  readonly errorDescription?: string | undefined;
  /** Absolute URI of a human-readable page explaining the error. */
  readonly errorUri?: string | undefined;
  /** URL of the protected resource metadata document (RFC 9728 5.1). */
  readonly resourceMetadata?: string | undefined;
}

// RFC 6749 appendix A: NQCHAR = %x21 / %x23-5B / %x5D-7E (no space, quote,
// or backslash); NQSCHAR adds the space. RFC 6750 assigns NQSCHAR to `error`
// and `error_description` and NQCHAR to `scope-token` and `error_uri`.
const NQCHAR_PATTERN = /^[\u0021\u0023-\u005B\u005D-\u007E]+$/u;
const NQSCHAR_PATTERN = /^[\u0020\u0021\u0023-\u005B\u005D-\u007E]+$/u;
// RFC 9110 5.6.4 quoted-string, restricted to printable ASCII; `"` and `\`
// become quoted-pairs.
const PRINTABLE_ASCII_PATTERN = /^[\u0020-\u007E]*$/u;
const QUOTED_PAIR_PATTERN = /["\\]/gu;

function reject(name: string, value: string, grammar: string): never {
  throw new TypeError(
    `bearerChallenge: ${name} must be ${grammar}; received ${JSON.stringify(value)}`,
  );
}

function realmParam(realm: string): string {
  if (!PRINTABLE_ASCII_PATTERN.test(realm)) {
    reject('realm', realm, 'printable ASCII (RFC 9110 quoted-string)');
  }
  return `realm="${realm.replaceAll(QUOTED_PAIR_PATTERN, '\\$&')}"`;
}

function scopeParam(
  scope: string | ReadonlyArray<string> | undefined,
): string | undefined {
  if (scope === undefined) {
    return undefined;
  }
  const tokens = typeof scope === 'string' ? scope.split(' ') : scope;
  if (tokens.length === 0) {
    return undefined;
  }
  for (const token of tokens) {
    if (!NQCHAR_PATTERN.test(token)) {
      reject(
        'scope',
        token,
        'a list of RFC 6749 scope-tokens (printable ASCII without space, quote, or backslash)',
      );
    }
  }
  return `scope="${tokens.join(' ')}"`;
}

function param(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    reject(
      name,
      value,
      pattern === NQCHAR_PATTERN
        ? 'printable ASCII without space, double quote, or backslash (RFC 6749 NQCHAR)'
        : 'printable ASCII without double quote or backslash (RFC 6749 NQSCHAR)',
    );
  }
  return `${name}="${value}"`;
}

/**
 * Builds the value of a `WWW-Authenticate` header for the Bearer scheme.
 * Attributes appear in RFC 6750 order: `realm`, `scope`, `error`,
 * `error_description`, `error_uri`, then RFC 9728 `resource_metadata`. Throws
 * a `TypeError` when a value falls outside the grammar its RFC assigns to it.
 *
 * @example
 * throw ban.unauthorized({
 *   headers: {
 *     'WWW-Authenticate': bearerChallenge({
 *       realm: 'api',
 *       error: 'invalid_token',
 *       errorDescription: 'The access token expired',
 *     }),
 *   },
 * });
 */
export function bearerChallenge(options: BearerChallengeOptions = {}): string {
  const params: Array<string> = [];
  if (options.realm !== undefined) {
    params.push(realmParam(options.realm));
  }
  const scope = scopeParam(options.scope);
  if (scope !== undefined) {
    params.push(scope);
  }
  const attributes: ReadonlyArray<
    readonly [string, string | undefined, RegExp]
  > = [
    ['error', options.error, NQSCHAR_PATTERN],
    ['error_description', options.errorDescription, NQSCHAR_PATTERN],
    ['error_uri', options.errorUri, NQCHAR_PATTERN],
    ['resource_metadata', options.resourceMetadata, NQCHAR_PATTERN],
  ];
  for (const [name, value, pattern] of attributes) {
    if (value !== undefined) {
      params.push(param(name, value, pattern));
    }
  }
  return `Bearer ${params.length === 0 ? 'realm=""' : params.join(', ')}`;
}
