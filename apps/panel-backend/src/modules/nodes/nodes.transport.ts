import { fetch, Agent } from 'undici';
import type {
  AddUserRequest,
  RemoveUserRequest,
  GetStatsResponse,
  HealthcheckResponse,
  HostMetricsResponse,
  NodeErrorResponse,
  ApplyInboundsRequest,
  ApplyInboundsResponse,
} from '@iceslab/shared';
import { bootstrapCa, getPanelClientCert } from '../keygen/keygen.service.js';

const DEFAULT_TIMEOUT_MS = 10_000;

// Shared HTTPS agent for ALL panel→node calls. undici reuses TCP+TLS
// connections within an Agent's pool, so /healthz and /metrics polls hit
// every node every 15s without paying handshake cost on each tick. Built
// lazily on first call (CA material requires DB roundtrip via bootstrapCa)
// and never closed — agent lifetime = process lifetime.
//
// If the CA rotates we'd need to reset this; today the CA is bootstrapped
// once at install and is treated as immutable. Slice for cert rotation later.
let sharedAgent: Agent | null = null;
let sharedAgentPromise: Promise<Agent> | null = null;

export interface MtlsOverride {
  /** PEM of the CA cert used to verify node server certs. */
  caCertPem: string;
  /** Panel-client leaf cert (clientAuth-only, signed by CA). */
  panelClientCertPem: string;
  panelClientKeyPem: string;
}

async function getSharedAgent(override?: MtlsOverride): Promise<Agent> {
  // Test injections must always build a fresh agent — they pass
  // synthetic CAs that mustn't leak between cases.
  if (override) {
    return new Agent({
      connect: {
        ca: override.caCertPem,
        cert: override.panelClientCertPem,
        key: override.panelClientKeyPem,
        rejectUnauthorized: true,
      },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
  }

  if (sharedAgent) return sharedAgent;
  if (sharedAgentPromise) return sharedAgentPromise;

  sharedAgentPromise = (async () => {
    // CA cert: trust anchor for verifying node server certs.
    // Panel-client cert: clientAuth-only leaf signed by CA. Slice S6 —
    // we no longer present the CA itself as our TLS leaf, which used to
    // mean any compromised node could impersonate the panel to its peers.
    const ca = await bootstrapCa();
    const panelClient = await getPanelClientCert();
    const agent = new Agent({
      connect: {
        ca: ca.certPem,
        cert: panelClient.certPem,
        key: panelClient.privateKeyPem,
        rejectUnauthorized: true,
      },
      // undici defaults are conservative for short-lived connections; we
      // want long-lived pools because we poll the same N hosts forever.
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      // Per-origin connection pool size. 2 is plenty: simultaneous calls
      // to the same node are rare (cron + occasional admin click).
      connections: 2,
    });
    sharedAgent = agent;
    return agent;
  })();
  return sharedAgentPromise;
}

/**
 * Tear down the shared agent — called on graceful shutdown so node-side
 * sockets get FIN'd cleanly instead of half-open.
 */
export async function closeNodeTransport(): Promise<void> {
  if (sharedAgent) {
    const a = sharedAgent;
    sharedAgent = null;
    sharedAgentPromise = null;
    await a.close();
  }
}

export class NodeRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: NodeErrorResponse | null,
  ) {
    super(message);
    this.name = 'NodeRequestError';
  }
}

export interface NodeTransportTarget {
  /** Host[:port] without scheme (matches what's stored in `nodes.address`). */
  address: string;
}

interface RequestOptions {
  timeoutMs?: number;
}

/**
 * Panel→node mTLS REST client. One instance per outgoing call (no pooling
 * yet — calls are infrequent and each one rebuilds the TLS agent). The CA
 * cert (via {@link bootstrapCa}) verifies the node's server cert. The
 * panel-client leaf (via {@link getPanelClientCert}) — clientAuth-only,
 * signed by the CA — is what the panel actually presents on handshake;
 * the CA private key never appears in a TLS exchange (slice S6).
 *
 * Tests can pass an `MtlsOverride` to inject a synthetic bundle without
 * touching the live `keygen_ca` table.
 */
export class NodeTransport {
  constructor(
    private readonly node: NodeTransportTarget,
    private readonly mtlsOverride?: MtlsOverride,
  ) {}

  private buildUrl(path: string): string {
    // node.address is admin-supplied — accept either `host` or `host:port`.
    // When the port is missing we default to the mTLS port the agent
    // listens on (1337 since wave-13, hard-coded in install-iceslab-node.sh;
    // was 8443 pre-2026-05-21). Without this, a fresh-out-of-the-box DNS
    // name like `node1.example.com` would hit 443 (since browsers default
    // that for `https://`), which is either closed (UFW only allows the
    // mTLS port) or a different service entirely (Caddy on the panel host
    // can be on the same domain). Result: cron healthcheck "unreachable"
    // with no clue why.
    const host = this.node.address.includes(':')
      ? this.node.address
      : `${this.node.address}:1337`;
    return `https://${host}${path}`;
  }

  private async request<TRes>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<TRes> {
    const agent = await getSharedAgent(this.mtlsOverride);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const res = await fetch(this.buildUrl(path), {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        dispatcher: agent,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as NodeErrorResponse | null;
        throw new NodeRequestError(
          `Node ${this.node.address} returned ${res.status}: ${errBody?.message ?? res.statusText}`,
          res.status,
          errBody,
        );
      }

      if (res.status === 204) return undefined as TRes;
      return (await res.json()) as TRes;
    } finally {
      clearTimeout(timer);
      // Test-mode override: per-call agent is short-lived, close it.
      // Production sharedAgent is process-scoped and stays open.
      if (this.mtlsOverride) {
        await agent.close();
      }
    }
  }

  // ───── API methods ─────

  async addUser(req: AddUserRequest): Promise<void> {
    await this.request<void>('POST', '/addUser', req);
  }

  async removeUser(req: RemoveUserRequest): Promise<void> {
    await this.request<void>('POST', '/removeUser', req);
  }

  async getStats(): Promise<GetStatsResponse> {
    return this.request<GetStatsResponse>('GET', '/stats');
  }

  async healthcheck(): Promise<HealthcheckResponse> {
    return this.request<HealthcheckResponse>('GET', '/healthz');
  }

  async getMetrics(): Promise<HostMetricsResponse> {
    return this.request<HostMetricsResponse>('GET', '/metrics', undefined, {
      // Metrics endpoint is local /proc reads — should be fast. Tight timeout
      // keeps the per-tick poller bounded if a node hangs.
      timeoutMs: 3_000,
    });
  }

  /**
   * Push the FULL inbound set for this node. Idempotent — node-agent diffs
   * against current state and only restarts/reloads the underlying protocol
   * server if something actually changed. Empty array is valid (means "this
   * node has no inbounds yet"); the node-agent will tear down any active
   * listener it had.
   */
  async applyInbounds(req: ApplyInboundsRequest): Promise<ApplyInboundsResponse> {
    return this.request<ApplyInboundsResponse>('POST', '/applyInbounds', req, {
      // Re-generating an Xray config + restart can take ~3-5 s; AmneziaWG
      // syncconf is faster but Caddy reload occasionally hits the LE rate
      // limiter. 30 s gives slack without making admin clicks feel hung.
      timeoutMs: 30_000,
    });
  }
}
