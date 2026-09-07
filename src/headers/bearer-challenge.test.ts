import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { bearerChallenge } from './bearer-challenge';

describe('bearerChallenge', () => {
  it('falls back to an empty realm because RFC 6750 requires one attribute', () => {
    expect(bearerChallenge()).toBe('Bearer realm=""');
    expect(bearerChallenge({ scope: [] })).toBe('Bearer realm=""');
  });

  it('writes the attributes in RFC 6750 order, then resource_metadata', () => {
    expect(
      bearerChallenge({
        resourceMetadata:
          'https://api.example.com/.well-known/oauth-protected-resource',
        errorUri: 'https://api.example.com/errors/invalid_token',
        errorDescription: 'The access token expired',
        error: 'invalid_token',
        scope: ['orders:read', 'orders:write'],
        realm: 'api',
      }),
    ).toBe(
      'Bearer realm="api", scope="orders:read orders:write", error="invalid_token", ' +
        'error_description="The access token expired", ' +
        'error_uri="https://api.example.com/errors/invalid_token", ' +
        'resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it('accepts a space-delimited scope string as well as a list', () => {
    expect(bearerChallenge({ scope: 'a b' })).toBe('Bearer scope="a b"');
    expect(bearerChallenge({ scope: 'a' })).toBe('Bearer scope="a"');
  });

  it('escapes quotes and backslashes in the realm as quoted-pairs', () => {
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-5.6.4
    expect(bearerChallenge({ realm: 'a"b\\c' })).toBe(
      'Bearer realm="a\\"b\\\\c"',
    );
  });

  it('rejects characters outside the grammar of each attribute', () => {
    expect(() => bearerChallenge({ realm: 'line\nbreak' })).toThrow(TypeError);
    expect(() =>
      bearerChallenge({ scope: ['orders:read', 'bad token'] }),
    ).toThrow(/scope/u);
    expect(() => bearerChallenge({ scope: 'a  b' })).toThrow(TypeError);
    expect(() => bearerChallenge({ error: 'invalid"token' })).toThrow(
      /error /u,
    );
    expect(() => bearerChallenge({ errorDescription: 'back\\slash' })).toThrow(
      TypeError,
    );
    expect(() =>
      bearerChallenge({ errorUri: 'https://x.example/a b' }),
    ).toThrow(/error_uri/u);
    expect(() => bearerChallenge({ resourceMetadata: 'not "quoted"' })).toThrow(
      /resource_metadata/u,
    );
    expect(() => bearerChallenge({ error: 'invalid_token\u00E9' })).toThrow(
      TypeError,
    );
  });

  it('is a valid header value the Headers class and the factories accept', () => {
    const ban = createBan();
    const value = bearerChallenge({
      realm: 'api',
      error: 'insufficient_scope',
    });
    const headers = new Headers({ 'WWW-Authenticate': value });
    expect(headers.get('www-authenticate')).toBe(value);
    const error = ban.forbidden({ headers: { 'WWW-Authenticate': value } });
    expect(error.headers.get('www-authenticate')).toBe(value);
    expect(ban.render(error).headers.get('www-authenticate')).toBe(value);
  });
});
