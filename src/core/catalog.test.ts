import { describe, expect, it } from 'vitest';

import { BUILTIN_CATALOG, FACTORY_NAMES, SECONDARY_KEYS } from './catalog';

/**
 * Every registered 4xx and 5xx status (418 excluded on purpose).
 * @ref https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml
 */
const IANA_ERROR_STATUSES = [
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501,
  502, 503, 504, 505, 506, 507, 508, 510, 511,
];

const IANA_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

describe('BUILTIN_CATALOG', () => {
  const primary = Object.entries(BUILTIN_CATALOG).filter(
    ([key]) => !SECONDARY_KEYS.has(key),
  );

  it('has exactly one primary entry per IANA error status, 418 excluded', () => {
    const statuses = primary.map(([, d]) => d.status).toSorted((a, b) => a - b);
    expect(statuses).toEqual(IANA_ERROR_STATUSES);
    expect(statuses).not.toContain(418);
  });

  it('uses the IANA reason phrase as the title of every primary entry', () => {
    for (const [, definition] of primary) {
      expect(definition.title).toBe(IANA_PHRASES[definition.status]);
    }
  });

  it('keeps secondary entries on a status that has a primary entry', () => {
    for (const key of SECONDARY_KEYS) {
      const secondary = BUILTIN_CATALOG[key as keyof typeof BUILTIN_CATALOG];
      expect(primary.some(([, d]) => d.status === secondary.status)).toBe(true);
    }
  });
});

describe('FACTORY_NAMES', () => {
  it('points every name at an existing key and covers every key', () => {
    const keys = new Set(Object.keys(BUILTIN_CATALOG));
    const targeted = new Set<string>();
    for (const key of Object.values(FACTORY_NAMES)) {
      expect(keys.has(key)).toBe(true);
      targeted.add(key);
    }
    expect([...targeted].toSorted()).toEqual([...keys].toSorted());
  });

  it('exposes the RFC 7231 (413) and RFC 4918 (422) names as aliases', () => {
    expect(FACTORY_NAMES.payloadTooLarge).toBe('CONTENT_TOO_LARGE');
    expect(FACTORY_NAMES.unprocessableEntity).toBe('UNPROCESSABLE_CONTENT');
  });
});
