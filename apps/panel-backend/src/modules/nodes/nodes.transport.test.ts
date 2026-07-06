import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  generateCa,
  generateNodeCert,
  generatePanelClientCert,
} from '../keygen/keygen.crypto.js';
import { NodeTransport, NodeRequestError, type MtlsOverride } from './nodes.transport.js';

interface ServerHandle {
  server: Server;
  address: string;
  mtls: MtlsOverride;
}

async function startMockMtlsServer(): Promise<ServerHandle> {
  const ca = await generateCa();
  const serverCert = await generateNodeCert(ca, {
    commonName: 'localhost',
    sans: [{ type: 'ip', value: '127.0.0.1' }],
  });
  // Slice S6: panel side now presents a clientAuth-only leaf, not the
  // CA itself. Build that here so the test exercises the same code path
  // production uses.
  const panelClient = await generatePanelClientCert(ca);

  const server = createServer(
    {
      cert: serverCert.certPem,
      key: serverCert.privateKeyPem,
      ca: ca.certPem,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        switch (req.url) {
          case '/addUser':
          case '/removeUser': {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, echoed: body ? JSON.parse(body) : null }));
            return;
          }
          case '/healthz': {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', cores: [] }));
            return;
          }
          case '/stats': {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                users: [],
                uptime: 42,
                totalBytesIn: 1000,
                totalBytesOut: 2000,
              }),
            );
            return;
          }
          case '/error': {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'INTERNAL', message: 'boom' }));
            return;
          }
          case '/slow': {
            // never respond, used to trigger client timeout
            return;
          }
          default: {
            res.writeHead(404);
            res.end();
          }
        }
      });
    },
  );

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    server,
    address: `127.0.0.1:${addr.port}`,
    mtls: {
      caCertPem: ca.certPem,
      panelClientCertPem: panelClient.certPem,
      panelClientKeyPem: panelClient.privateKeyPem,
    },
  };
}

let handle: ServerHandle;

beforeAll(async () => {
  handle = await startMockMtlsServer();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    handle.server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('NodeTransport (mTLS)', () => {
  it('addUser performs an mTLS POST and resolves on 200', async () => {
    const transport = new NodeTransport({ address: handle.address }, handle.mtls);
    await expect(
      transport.addUser({
        userId: '11111111-1111-1111-1111-111111111111',
        shortId: 'short',
        username: 'alice',
        credentials: { hysteriaPassword: 'h' },
      }),
    ).resolves.toBeUndefined();
  });

  it('removeUser resolves on 200', async () => {
    const transport = new NodeTransport({ address: handle.address }, handle.mtls);
    await expect(
      transport.removeUser({ userId: '11111111-1111-1111-1111-111111111111' }),
    ).resolves.toBeUndefined();
  });

  it('healthcheck returns parsed body', async () => {
    const transport = new NodeTransport({ address: handle.address }, handle.mtls);
    const result = await transport.healthcheck();
    expect(result.status).toBe('ok');
    expect(Array.isArray(result.cores)).toBe(true);
  });

  it('getStats returns parsed body', async () => {
    const transport = new NodeTransport({ address: handle.address }, handle.mtls);
    const stats = await transport.getStats();
    expect(stats.uptime).toBe(42);
    expect(stats.totalBytesIn).toBe(1000);
  });

  it('throws NodeRequestError when the node returns 5xx', async () => {
    // Point the transport at a node whose `addUser` route is the mock's `/error`.
    // We expose this by giving the transport a target whose path-prefix lands on
    // /error, easiest via URL bypass through a tiny subclass.
    class ErrorRouteTransport extends NodeTransport {
      addUserViaError() {
        return (this as unknown as {
          request: (m: string, p: string, b?: unknown) => Promise<unknown>;
        }).request('POST', '/error', { foo: 'bar' });
      }
    }
    const transport = new ErrorRouteTransport(
      { address: handle.address },
      handle.mtls,
    );
    await expect(transport.addUserViaError()).rejects.toBeInstanceOf(NodeRequestError);
  });
});
