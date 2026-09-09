import type { Database } from './pglite';

import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll } from 'vitest';

/**
 * Serves a test file's PGlite over the PostgreSQL wire protocol on a loopback
 * TCP port chosen by the OS, so real drivers (node-postgres, postgres.js)
 * connect to the same database the file seeded and throw their own error
 * classes for the same statements. The server forwards backend bytes
 * untouched, so every ErrorResponse field (SQLSTATE, severity, constraint,
 * table, column) reaches the driver as a real server would send it.
 *
 * Limits that shape the tests: no SSL (drivers must not request it), one
 * backend session (`maxConnections` stays 1; drivers use one connection), and
 * PGlite answers each extended-protocol message with its own ReadyForQuery,
 * which desynchronizes a driver after a failed parameterized statement
 * (electric-sql/pglite issue 958). The failing statements are therefore sent
 * through the simple query protocol: no parameters.
 * @ref https://pglite.dev/docs/pglite-socket
 * @ref https://github.com/electric-sql/pglite/blob/main/packages/pglite-socket/README.md
 * @ref https://github.com/electric-sql/pglite/issues/958
 */

export interface SocketEndpoint {
  readonly host: string;
  readonly port: number;
}

const HOST = '127.0.0.1';

/**
 * Starts the socket server after the database is seeded (`beforeAll` hooks
 * run in registration order) and stops it before the database closes
 * (`afterAll` hooks run in reverse). Call after `useDatabase()`.
 */
export function useSocketServer({ db }: Database): () => SocketEndpoint {
  let endpoint: SocketEndpoint | undefined;
  let server: PGLiteSocketServer | undefined;
  beforeAll(async () => {
    server = new PGLiteSocketServer({ db, host: HOST, port: 0 });
    await server.start();
    // `getServerConn()` is `${host}:${port}` with the bound port once started.
    const conn = server.getServerConn();
    const port = Number(conn.slice(conn.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`unexpected socket address ${conn}`);
    }
    endpoint = { host: HOST, port };
  });
  afterAll(async () => {
    await server?.stop();
  });
  return () => {
    if (endpoint === undefined) {
      throw new Error('socket server not started');
    }
    return endpoint;
  };
}
