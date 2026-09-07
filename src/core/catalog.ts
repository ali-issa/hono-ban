/**
 * Built-in error catalog (SPEC 3). Titles are the IANA reason phrases; 413 and
 * 422 use the RFC 9110 names, and the names they replaced (RFC 7231 for 413,
 * RFC 4918 for 422, which RFC 7231 never defined) are kept as factory
 * aliases. 418 is deliberately absent.
 * @ref https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml
 * @ref https://www.rfc-editor.org/rfc/rfc9110#name-status-codes
 * @ref https://www.rfc-editor.org/rfc/rfc7231#section-6.5.11 (413 Payload Too Large)
 * @ref https://www.rfc-editor.org/rfc/rfc4918#section-11.2 (422 Unprocessable Entity)
 * @ref https://www.rfc-editor.org/rfc/rfc9110#appendix-B.3 (422 added from WebDAV)
 * @packageDocumentation
 */

export const BUILTIN_CATALOG = {
  BAD_REQUEST: { status: 400, title: 'Bad Request' },
  MALFORMED_JSON: { status: 400, title: 'Malformed JSON' },
  UNAUTHORIZED: { status: 401, title: 'Unauthorized' },
  PAYMENT_REQUIRED: { status: 402, title: 'Payment Required' },
  FORBIDDEN: { status: 403, title: 'Forbidden' },
  NOT_FOUND: { status: 404, title: 'Not Found' },
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method Not Allowed' },
  NOT_ACCEPTABLE: { status: 406, title: 'Not Acceptable' },
  PROXY_AUTHENTICATION_REQUIRED: {
    status: 407,
    title: 'Proxy Authentication Required',
  },
  REQUEST_TIMEOUT: { status: 408, title: 'Request Timeout' },
  CONFLICT: { status: 409, title: 'Conflict' },
  GONE: { status: 410, title: 'Gone' },
  LENGTH_REQUIRED: { status: 411, title: 'Length Required' },
  PRECONDITION_FAILED: { status: 412, title: 'Precondition Failed' },
  CONTENT_TOO_LARGE: { status: 413, title: 'Content Too Large' },
  URI_TOO_LONG: { status: 414, title: 'URI Too Long' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported Media Type' },
  RANGE_NOT_SATISFIABLE: { status: 416, title: 'Range Not Satisfiable' },
  EXPECTATION_FAILED: { status: 417, title: 'Expectation Failed' },
  MISDIRECTED_REQUEST: { status: 421, title: 'Misdirected Request' },
  UNPROCESSABLE_CONTENT: { status: 422, title: 'Unprocessable Content' },
  VALIDATION_FAILED: { status: 422, title: 'Validation Failed' },
  LOCKED: { status: 423, title: 'Locked' },
  FAILED_DEPENDENCY: { status: 424, title: 'Failed Dependency' },
  TOO_EARLY: { status: 425, title: 'Too Early' },
  UPGRADE_REQUIRED: { status: 426, title: 'Upgrade Required' },
  PRECONDITION_REQUIRED: { status: 428, title: 'Precondition Required' },
  TOO_MANY_REQUESTS: { status: 429, title: 'Too Many Requests' },
  REQUEST_HEADER_FIELDS_TOO_LARGE: {
    status: 431,
    title: 'Request Header Fields Too Large',
  },
  UNAVAILABLE_FOR_LEGAL_REASONS: {
    status: 451,
    title: 'Unavailable For Legal Reasons',
  },
  INTERNAL_SERVER_ERROR: { status: 500, title: 'Internal Server Error' },
  NOT_IMPLEMENTED: { status: 501, title: 'Not Implemented' },
  BAD_GATEWAY: { status: 502, title: 'Bad Gateway' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service Unavailable' },
  GATEWAY_TIMEOUT: { status: 504, title: 'Gateway Timeout' },
  HTTP_VERSION_NOT_SUPPORTED: {
    status: 505,
    title: 'HTTP Version Not Supported',
  },
  VARIANT_ALSO_NEGOTIATES: { status: 506, title: 'Variant Also Negotiates' },
  INSUFFICIENT_STORAGE: { status: 507, title: 'Insufficient Storage' },
  LOOP_DETECTED: { status: 508, title: 'Loop Detected' },
  NOT_EXTENDED: { status: 510, title: 'Not Extended' },
  NETWORK_AUTHENTICATION_REQUIRED: {
    status: 511,
    title: 'Network Authentication Required',
  },
} as const;

export type BuiltinCatalog = typeof BUILTIN_CATALOG;
export type BuiltinKey = keyof BuiltinCatalog;

/**
 * Entries that share a status with a primary entry. They are never chosen
 * when an error is looked up by status alone (SPEC 3, 5.5).
 */
export const SECONDARY_KEYS: ReadonlySet<string> = new Set<BuiltinKey>([
  'MALFORMED_JSON',
  'VALIDATION_FAILED',
]);

/** camelCase factory name to catalog key. Aliases point at the same key. */
export const FACTORY_NAMES = {
  badRequest: 'BAD_REQUEST',
  malformedJson: 'MALFORMED_JSON',
  unauthorized: 'UNAUTHORIZED',
  paymentRequired: 'PAYMENT_REQUIRED',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  methodNotAllowed: 'METHOD_NOT_ALLOWED',
  notAcceptable: 'NOT_ACCEPTABLE',
  proxyAuthenticationRequired: 'PROXY_AUTHENTICATION_REQUIRED',
  requestTimeout: 'REQUEST_TIMEOUT',
  conflict: 'CONFLICT',
  gone: 'GONE',
  lengthRequired: 'LENGTH_REQUIRED',
  preconditionFailed: 'PRECONDITION_FAILED',
  contentTooLarge: 'CONTENT_TOO_LARGE',
  // RFC 7231 name for 413.
  payloadTooLarge: 'CONTENT_TOO_LARGE',
  uriTooLong: 'URI_TOO_LONG',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  rangeNotSatisfiable: 'RANGE_NOT_SATISFIABLE',
  expectationFailed: 'EXPECTATION_FAILED',
  misdirectedRequest: 'MISDIRECTED_REQUEST',
  unprocessableContent: 'UNPROCESSABLE_CONTENT',
  // RFC 4918 name for 422.
  unprocessableEntity: 'UNPROCESSABLE_CONTENT',
  validationFailed: 'VALIDATION_FAILED',
  locked: 'LOCKED',
  failedDependency: 'FAILED_DEPENDENCY',
  tooEarly: 'TOO_EARLY',
  upgradeRequired: 'UPGRADE_REQUIRED',
  preconditionRequired: 'PRECONDITION_REQUIRED',
  tooManyRequests: 'TOO_MANY_REQUESTS',
  requestHeaderFieldsTooLarge: 'REQUEST_HEADER_FIELDS_TOO_LARGE',
  unavailableForLegalReasons: 'UNAVAILABLE_FOR_LEGAL_REASONS',
  internalServerError: 'INTERNAL_SERVER_ERROR',
  notImplemented: 'NOT_IMPLEMENTED',
  badGateway: 'BAD_GATEWAY',
  serviceUnavailable: 'SERVICE_UNAVAILABLE',
  gatewayTimeout: 'GATEWAY_TIMEOUT',
  httpVersionNotSupported: 'HTTP_VERSION_NOT_SUPPORTED',
  variantAlsoNegotiates: 'VARIANT_ALSO_NEGOTIATES',
  insufficientStorage: 'INSUFFICIENT_STORAGE',
  loopDetected: 'LOOP_DETECTED',
  notExtended: 'NOT_EXTENDED',
  networkAuthenticationRequired: 'NETWORK_AUTHENTICATION_REQUIRED',
} as const;

export type FactoryName = keyof typeof FACTORY_NAMES;
