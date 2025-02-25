import { describe, it, expect } from "bun:test";
import {
  badRequest,
  notFound,
  unauthorized,
  paymentRequired,
  forbidden,
  methodNotAllowed,
  notAcceptable,
  clientTimeout,
  conflict,
  resourceGone,
  badData,
  tooManyRequests,
  teapot,
  illegal,
  lengthRequired,
  preconditionFailed,
  entityTooLarge,
  uriTooLong,
  unsupportedMediaType,
  rangeNotSatisfiable,
  expectationFailed,
} from "../../factories/client-errors";
import {
  internal,
  badImplementation,
  serverUnavailable,
  notImplemented,
  badGateway,
  gatewayTimeout,
  httpVersionNotSupported,
  insufficientStorage,
  loopDetected,
  variantAlsoNegotiates,
  notExtended,
  networkAuthRequired,
} from "../../factories/server-errors";
import { STATUS_CODES } from "../../constants";

describe("Error factories", () => {
  describe("Client error factories", () => {
    it("creates a 400 Bad Request error", () => {
      const error = badRequest();
      expect(error.status).toBe(400);
      expect(error.message).toBe(STATUS_CODES[400]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 401 Unauthorized error", () => {
      const error = unauthorized();
      expect(error.status).toBe(401);
      expect(error.message).toBe(STATUS_CODES[401]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 402 Payment Required error", () => {
      const error = paymentRequired();
      expect(error.status).toBe(402);
      expect(error.message).toBe(STATUS_CODES[402]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 403 Forbidden error", () => {
      const error = forbidden();
      expect(error.status).toBe(403);
      expect(error.message).toBe(STATUS_CODES[403]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 404 Not Found error", () => {
      const error = notFound();
      expect(error.status).toBe(404);
      expect(error.message).toBe(STATUS_CODES[404]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 405 Method Not Allowed error", () => {
      const error = methodNotAllowed();
      expect(error.status).toBe(405);
      expect(error.message).toBe(STATUS_CODES[405]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 406 Not Acceptable error", () => {
      const error = notAcceptable();
      expect(error.status).toBe(406);
      expect(error.message).toBe(STATUS_CODES[406]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 408 Request Timeout error", () => {
      const error = clientTimeout();
      expect(error.status).toBe(408);
      expect(error.message).toBe(STATUS_CODES[408]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 409 Conflict error", () => {
      const error = conflict();
      expect(error.status).toBe(409);
      expect(error.message).toBe(STATUS_CODES[409]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 410 Gone error", () => {
      const error = resourceGone();
      expect(error.status).toBe(410);
      expect(error.message).toBe(STATUS_CODES[410]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 411 Length Required error", () => {
      const error = lengthRequired();
      expect(error.status).toBe(411);
      expect(error.message).toBe(STATUS_CODES[411]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 412 Precondition Failed error", () => {
      const error = preconditionFailed();
      expect(error.status).toBe(412);
      expect(error.message).toBe(STATUS_CODES[412]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 413 Payload Too Large error", () => {
      const error = entityTooLarge();
      expect(error.status).toBe(413);
      expect(error.message).toBe(STATUS_CODES[413]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 414 URI Too Long error", () => {
      const error = uriTooLong();
      expect(error.status).toBe(414);
      expect(error.message).toBe(STATUS_CODES[414]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 415 Unsupported Media Type error", () => {
      const error = unsupportedMediaType();
      expect(error.status).toBe(415);
      expect(error.message).toBe(STATUS_CODES[415]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 416 Range Not Satisfiable error", () => {
      const error = rangeNotSatisfiable();
      expect(error.status).toBe(416);
      expect(error.message).toBe(STATUS_CODES[416]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 417 Expectation Failed error", () => {
      const error = expectationFailed();
      expect(error.status).toBe(417);
      expect(error.message).toBe(STATUS_CODES[417]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 418 I'm a Teapot error", () => {
      const error = teapot();
      expect(error.status).toBe(418);
      expect(error.message).toBe(STATUS_CODES[418]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 422 Unprocessable Entity error", () => {
      const error = badData();
      expect(error.status).toBe(422);
      expect(error.message).toBe(STATUS_CODES[422]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 429 Too Many Requests error", () => {
      const error = tooManyRequests();
      expect(error.status).toBe(429);
      expect(error.message).toBe(STATUS_CODES[429]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 451 Unavailable For Legal Reasons error", () => {
      const error = illegal();
      expect(error.status).toBe(451);
      expect(error.message).toBe(STATUS_CODES[451]);
      expect(error.isBan).toBe(true);
    });

    it("accepts a custom message", () => {
      const message = "Custom error message";
      const error = unauthorized(message);
      expect(error.status).toBe(401);
      expect(error.message).toBe(message);
    });

    it("accepts options object", () => {
      const options = {
        message: "Custom message",
        data: { field: "test" },
        headers: { "X-Custom": "value" },
      };

      const error = badRequest(options);

      expect(error.status).toBe(400);
      expect(error.message).toBe(options.message);
      expect(error.data).toEqual(options.data);
      expect(error.headers).toEqual(options.headers);
    });

    it("accepts message and options separately", () => {
      const message = "Custom message";
      const options = {
        data: { field: "test" },
        headers: { "X-Custom": "value" },
      };

      const error = notFound(message, options);

      expect(error.status).toBe(404);
      expect(error.message).toBe(message);
      expect(error.data).toEqual(options.data);
      expect(error.headers).toEqual(options.headers);
    });
  });

  describe("Server error factories", () => {
    it("creates a 500 Internal Server Error", () => {
      const error = internal();
      expect(error.status).toBe(500);
      expect(error.message).toBe(STATUS_CODES[500]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 501 Not Implemented error", () => {
      const error = notImplemented();
      expect(error.status).toBe(501);
      expect(error.message).toBe(STATUS_CODES[501]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 502 Bad Gateway error", () => {
      const error = badGateway();
      expect(error.status).toBe(502);
      expect(error.message).toBe(STATUS_CODES[502]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 503 Service Unavailable error", () => {
      const error = serverUnavailable();
      expect(error.status).toBe(503);
      expect(error.message).toBe(STATUS_CODES[503]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 504 Gateway Timeout error", () => {
      const error = gatewayTimeout();
      expect(error.status).toBe(504);
      expect(error.message).toBe(STATUS_CODES[504]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 505 HTTP Version Not Supported error", () => {
      const error = httpVersionNotSupported();
      expect(error.status).toBe(505);
      expect(error.message).toBe(STATUS_CODES[505]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 507 Insufficient Storage error", () => {
      const error = insufficientStorage();
      expect(error.status).toBe(507);
      expect(error.message).toBe(STATUS_CODES[507]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 508 Loop Detected error", () => {
      const error = loopDetected();
      expect(error.status).toBe(508);
      expect(error.message).toBe(STATUS_CODES[508]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 506 Variant Also Negotiates error", () => {
      const error = variantAlsoNegotiates();
      expect(error.status).toBe(506);
      expect(error.message).toBe(STATUS_CODES[506]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 510 Not Extended error", () => {
      const error = notExtended();
      expect(error.status).toBe(510);
      expect(error.message).toBe(STATUS_CODES[510]);
      expect(error.isBan).toBe(true);
    });

    it("creates a 511 Network Authentication Required error", () => {
      const error = networkAuthRequired();
      expect(error.status).toBe(511);
      expect(error.message).toBe(STATUS_CODES[511]);
      expect(error.isBan).toBe(true);
    });

    it("accepts a custom message", () => {
      const message = "Custom error message";
      const error = internal(message);
      expect(error.status).toBe(500);
      expect(error.message).toBe(message);
    });

    it("accepts options object", () => {
      const options = {
        message: "Custom message",
        data: { field: "test" },
        headers: { "X-Custom": "value" },
      };

      const error = serverUnavailable(options);

      expect(error.status).toBe(503);
      expect(error.message).toBe(options.message);
      expect(error.data).toEqual(options.data);
      expect(error.headers).toEqual(options.headers);
    });

    it("accepts message and options separately", () => {
      const message = "Custom message";
      const options = {
        data: { field: "test" },
        headers: { "X-Custom": "value" },
      };

      const error = internal(message, options);

      expect(error.status).toBe(500);
      expect(error.message).toBe(message);
      expect(error.data).toEqual(options.data);
      expect(error.headers).toEqual(options.headers);
    });
  });

  describe("badImplementation", () => {
    it("creates a developer error", () => {
      const error = badImplementation();

      expect(error.status).toBe(500);
      expect(error.message).toBe(STATUS_CODES[500]);
      expect(error.data).toEqual({ isDeveloperError: true });
    });

    it("merges custom data with isDeveloperError flag", () => {
      const error = badImplementation({
        data: { field: "test" },
      });

      // Use type assertion to check the data structure
      const data = error.data as { isDeveloperError: boolean; field: string };
      expect(data.isDeveloperError).toBe(true);
      expect(data.field).toBe("test");
    });

    it("accepts message and options separately", () => {
      const message = "Developer error";
      const options = {
        data: { field: "test" },
      };

      const error = badImplementation(message, options);

      expect(error.status).toBe(500);
      expect(error.message).toBe(message);
      // Use type assertion to check the data structure
      const data = error.data as { isDeveloperError: boolean; field: string };
      expect(data.isDeveloperError).toBe(true);
      expect(data.field).toBe("test");
    });
  });
});
