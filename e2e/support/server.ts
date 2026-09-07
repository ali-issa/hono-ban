import type { ServerType } from '@hono/node-server';

import { serve } from '@hono/node-server';

import type { AddressInfo } from 'node:net';

/** Anything with a Hono-compatible `fetch`, including `OpenAPIHono`. */
export interface FetchApp {
  readonly fetch: (request: Request) => unknown;
}

export interface RunningServer {
  /** Origin of the listening server, for example `http://127.0.0.1:53211`. */
  readonly url: string;
  /** `fetch` bound to the server origin; `path` starts with `/`. */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly close: () => Promise<void>;
}

/**
 * Starts `app` on an ephemeral loopback port with `@hono/node-server`.
 * Port 0 makes the OS pick a free port, so test files can run in parallel
 * without coordinating ports. Global `Request`/`Response` are overridden by
 * the adapter as they would be in a real deployment (its default).
 * @ref https://github.com/honojs/node-server#options
 * @ref https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
 */
export async function startServer(app: FetchApp): Promise<RunningServer> {
  const { server, info } = await new Promise<{
    server: ServerType;
    info: AddressInfo;
  }>((resolve) => {
    const started: ServerType = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
      (address) => {
        resolve({ server: started, info: address });
      },
    );
  });
  const url = `http://127.0.0.1:${String(info.port)}`;
  return {
    url,
    fetch: async (path, init) => fetch(`${url}${path}`, init),
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}
