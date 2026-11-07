// Builds the fleet of a load-test cell through the panel's own API: first admin,
// one xray profile, N nodes with a host each, and N squads that each reach
// REACH nodes in a ring. Writes .work/nodes.json (the payloads, secret) for
// synth-agent and .work/state.json for the seed and for k6.
//
//   node scripts/loadstand/setup.mjs <nodes> <agent-host> <reach>
//
// PANEL_URL, B2_ADMIN_USER and B2_ADMIN_PASSWORD come from the environment.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const work = join(dirname(fileURLToPath(import.meta.url)), '.work');
const FIRST_PORT = 20000;
const INBOUND_PORT = 443;

const [nodesArg, agentHost, reachArg] = process.argv.slice(2);
const nodeCount = Number(nodesArg);
const reach = Number(reachArg);
if (!Number.isInteger(nodeCount) || nodeCount < 1 || !agentHost || !Number.isInteger(reach) || reach < 1) {
  console.error('usage: setup.mjs <nodes> <agent-host> <reach>');
  process.exit(2);
}
const { PANEL_URL, B2_ADMIN_USER, B2_ADMIN_PASSWORD } = process.env;
if (!PANEL_URL || !B2_ADMIN_USER || !B2_ADMIN_PASSWORD) {
  console.error('PANEL_URL, B2_ADMIN_USER and B2_ADMIN_PASSWORD are required');
  process.exit(2);
}

let token = null;

async function api(method, path, body) {
  for (;;) {
    const res = await fetch(`${PANEL_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // The panel's limit of 100 requests a minute per address has no setting, and
    // a fleet of 50 takes more than that. Its answer says how long to wait.
    if (res.status === 429) {
      const { retryAfterSeconds = 60 } = JSON.parse(text);
      await new Promise((done) => setTimeout(done, (retryAfterSeconds + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
}

const status = await api('GET', '/api/auth/status');
if (status.registration.enabled) {
  await api('POST', '/api/auth/register', { username: B2_ADMIN_USER, password: B2_ADMIN_PASSWORD });
}
({ token } = await api('POST', '/api/auth/login', { username: B2_ADMIN_USER, password: B2_ADMIN_PASSWORD }));

const keys = await api('POST', '/api/profiles/generate-keypair?protocol=xray');
const profile = await api('POST', '/api/profiles', {
  name: 'b2-xray',
  protocol: 'xray',
  config: {
    subprotocol: 'vless',
    security: 'reality',
    network: 'raw',
    flow: 'xtls-rprx-vision',
    realityDest: 'www.cloudflare.com:443',
    realityServerNames: ['www.cloudflare.com'],
    realityShortIds: [randomBytes(4).toString('hex')],
    realityPrivateKey: keys.privateKey,
    realityPublicKey: keys.publicKey,
  },
});

const fleet = [];
const hostIds = [];
for (let i = 0; i < nodeCount; i++) {
  const name = `b2-${String(i).padStart(3, '0')}`;
  const port = FIRST_PORT + i;
  const node = await api('POST', '/api/nodes', {
    name,
    address: `${agentHost}:${port}`,
    intendedEngines: ['xray'],
    countryCode: 'DE',
  });
  if (!node.payload) throw new Error(`${name}: the panel answered no payload`);
  fleet.push({ name, port, payload: node.payload });
  const host = await api('POST', '/api/hosts', {
    profileId: profile.id,
    nodeId: node.id,
    port: INBOUND_PORT,
    remark: name,
  });
  hostIds.push(host.id);
}

const squads = [];
for (let i = 0; i < nodeCount; i++) {
  const hosts = Array.from({ length: Math.min(reach, nodeCount) }, (_, k) => hostIds[(i + k) % nodeCount]);
  const squad = await api('POST', '/api/squads', {
    name: `b2-squad-${String(i).padStart(3, '0')}`,
    profileIds: [profile.id],
    hostIds: hosts,
  });
  squads.push(squad.id);
}

mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'nodes.json'), JSON.stringify(fleet), { mode: 0o600 });
writeFileSync(join(work, 'state.json'), JSON.stringify({ profileId: profile.id, squads, token }), { mode: 0o600 });
console.log(`nodes=${fleet.length} hosts=${hostIds.length} squads=${squads.length}`);
