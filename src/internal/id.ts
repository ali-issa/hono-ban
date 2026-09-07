/**
 * Generates an occurrence id for an error. One id is minted per error and
 * used everywhere it is referenced: response body, response header, and
 * the report handed to observability hooks.
 *
 * Uses Web Crypto so the same code runs on Node, Bun, Deno, and workerd.
 * `randomUUID()` yields a version 4 UUID; the Web Cryptography spec still
 * cites RFC 4122, which RFC 9562 obsoletes without changing the format.
 * @ref https://w3c.github.io/webcrypto/#Crypto-method-randomUUID
 * @ref https://www.rfc-editor.org/rfc/rfc9562#section-5.4
 */
export function generateErrorId(): string {
  return crypto.randomUUID();
}
