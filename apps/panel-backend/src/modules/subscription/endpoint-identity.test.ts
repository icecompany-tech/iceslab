import { describe, expect, it } from 'vitest';
import { disambiguateEndpointLabels, expandEndpointUris } from './subscription.service.js';
import { endpointKey, endpointTag } from './endpoint-identity.js';
import { encodePlainList, type SubscriptionEndpoint } from './subscription.formats.js';
import { buildXrayJson, buildXrayJsonArray } from './formats/xrayjson.js';
import { buildSingboxJson } from './formats/singbox.js';
import { buildClashYaml } from './formats/clash.js';

/**
 * Two bindings on ONE node whose hosts nobody named.
 *
 * This is the ordinary shape - an operator adds a second transport to a machine
 * and leaves the auto-created "Default" host alone - and it used to produce two
 * endpoints that were the same string all the way down: the same line in the
 * client, and from that line the same outbound tag, the same sing-box tag and
 * the same Clash proxy name. Routing rules and selector groups then pointed at a
 * name two outbounds answered to (audit A-020), and in the plain list the two
 * rows could not be told apart at all (operator, 2026-08-29).
 */
const base: Omit<SubscriptionEndpoint, 'network' | 'key' | 'uri'> & Record<string, unknown> = {
  protocol: 'xray',
  nodeName: '🇷🇺 ru-01',
  nodeId: 'node-1',
  host: 'ru1.example.com',
  port: 443,
  uuid: '11111111-2222-3333-4444-555555555555',
  publicKey: 'pubkey',
  shortId: 'ab12',
  sni: 'www.cloudflare.com',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
};

function twoWaysIn(): SubscriptionEndpoint[] {
  return [
    {
      ...base,
      key: 'host-xhttp',
      network: 'xhttp',
      uri: 'vless://11111111-2222-3333-4444-555555555555@ru1.example.com:443?type=xhttp#%F0%9F%87%B7%F0%9F%87%BA%20ru-01',
    } as SubscriptionEndpoint,
    {
      ...base,
      key: 'host-grpc',
      network: 'grpc',
      uri: 'vless://11111111-2222-3333-4444-555555555555@ru1.example.com:443?type=grpc#%F0%9F%87%B7%F0%9F%87%BA%20ru-01',
    } as SubscriptionEndpoint,
  ];
}

function decodePlain(body: string): string[] {
  return Buffer.from(body, 'base64').toString('utf8').split('\n').filter(Boolean);
}

describe('two unnamed ways into one node', () => {
  it('reads as two different lines, each naming what differs', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    expect(endpoints[0]!.nodeName).toBe('🇷🇺 ru-01 · XHTTP');
    expect(endpoints[1]!.nodeName).toBe('🇷🇺 ru-01 · gRPC');
  });

  it('carries the new name into the share link, which is what plain hands out', () => {
    // The link is built one binding at a time, before there is a list to
    // compare against, so a label decided later never reached it: the panel
    // showed two distinguishable rows and the client showed two identical ones.
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const lines = decodePlain(encodePlainList(endpoints.flatMap(expandEndpointUris)));
    const remarks = lines.map((l) => decodeURIComponent(l.slice(l.indexOf('#') + 1)));
    expect(remarks).toEqual(['🇷🇺 ru-01 · XHTTP', '🇷🇺 ru-01 · gRPC']);
    expect(new Set(remarks).size).toBe(2);
  });

  it('names the port when the transport is the same too', () => {
    const endpoints = twoWaysIn().map((e, i) => ({ ...e, network: 'raw', port: 443 + i * 1000 }) as SubscriptionEndpoint);
    disambiguateEndpointLabels(endpoints);
    expect(endpoints.map((e) => e.nodeName)).toEqual(['🇷🇺 ru-01 · 443', '🇷🇺 ru-01 · 1443']);
  });

  it('leaves a name that collides with nothing alone', () => {
    const [first] = twoWaysIn();
    const endpoints = [first!];
    disambiguateEndpointLabels(endpoints);
    expect(endpoints[0]!.nodeName).toBe('🇷🇺 ru-01');
  });

  it('never merges two lines, even when nothing about them differs', () => {
    // Same node, transport, host and port: the endpoints are distinct rows in
    // the database and nothing observable separates them. A subscription may
    // not answer that with one line silently swallowing the other.
    const endpoints = twoWaysIn().map((e) => ({ ...e, network: 'raw' }) as SubscriptionEndpoint);
    disambiguateEndpointLabels(endpoints);
    expect(endpoints[0]!.nodeName).not.toBe(endpoints[1]!.nodeName);
  });

  it('renames a vmess link inside its payload, not after a hash', () => {
    const payload = Buffer.from(
      JSON.stringify({ v: '2', ps: '🇷🇺 ru-01', add: 'ru1.example.com', port: '443' }),
      'utf-8',
    ).toString('base64');
    const endpoints = twoWaysIn();
    endpoints[0]!.uri = `vmess://${payload}`;
    (endpoints[0] as { subprotocol?: string }).subprotocol = 'vmess';
    disambiguateEndpointLabels(endpoints);
    const decoded = JSON.parse(
      Buffer.from(endpoints[0]!.uri.slice('vmess://'.length), 'base64').toString('utf-8'),
    ) as { ps: string; add: string };
    expect(decoded.ps).toBe('🇷🇺 ru-01 · XHTTP');
    expect(decoded.add).toBe('ru1.example.com');
  });
});

describe('identifiers in the full formats', () => {
  it('xray-json: distinct outbound tags, and every rule points at one that exists', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const cfg = JSON.parse(buildXrayJson(endpoints, { customDomainLists: { block: [], direct: [], proxy: ['youtube.com'] } })) as {
      outbounds: { tag: string }[];
      routing: { rules: { outboundTag?: string }[] };
    };
    const tags = cfg.outbounds.map((o) => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const rule of cfg.routing.rules) {
      if (rule.outboundTag) expect(tags).toContain(rule.outboundTag);
    }
  });

  it('xray-json: the balancer selects tags that exist', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const cfg = JSON.parse(buildXrayJson(endpoints, { bundle: 'balancer' })) as {
      outbounds: { tag: string }[];
      routing: { balancers?: { selector: string[] }[] };
      observatory?: { subjectSelector: string[] };
    };
    const tags = cfg.outbounds.map((o) => o.tag);
    for (const t of cfg.routing.balancers![0]!.selector) expect(tags).toContain(t);
    expect(cfg.observatory!.subjectSelector).toEqual(cfg.routing.balancers![0]!.selector);
  });

  it('sing-box: distinct tags, and the selector names only tags it has', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const cfg = JSON.parse(buildSingboxJson(endpoints)) as {
      outbounds: { tag: string; type: string; outbounds?: string[] }[];
    };
    const tags = cfg.outbounds.map((o) => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
    const selector = cfg.outbounds.find((o) => o.type === 'selector')!;
    for (const t of selector.outbounds!) expect(tags).toContain(t);
  });

  it('clash: distinct proxy names, and the group names only proxies it has', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const yaml = buildClashYaml(endpoints);
    const names = [...yaml.matchAll(/^ {2}- name: (.+)$/gm)].map((m) => m[1]!.trim());
    const proxies = names.filter((n) => n !== 'Auto');
    expect(new Set(proxies).size).toBe(proxies.length);
    for (const referenced of [...yaml.matchAll(/^ {6}- (.+)$/gm)].map((m) => m[1]!.trim())) {
      expect(proxies.map((p) => p.replace(/^["']|["']$/g, ''))).toContain(
        referenced.replace(/^["']|["']$/g, ''),
      );
    }
  });

  it('xray-json array: one standalone config per way in, each routing to its own proxy', () => {
    const endpoints = twoWaysIn();
    disambiguateEndpointLabels(endpoints);
    const arr = JSON.parse(buildXrayJsonArray(endpoints)) as {
      remarks: string;
      outbounds: { tag: string }[];
      routing: { rules: { outboundTag?: string }[] };
    }[];
    expect(arr.map((c) => c.remarks)).toEqual(['🇷🇺 ru-01 · XHTTP', '🇷🇺 ru-01 · gRPC']);
    for (const cfg of arr) {
      const own = cfg.outbounds[0]!.tag;
      expect(cfg.routing.rules[cfg.routing.rules.length - 1]!.outboundTag).toBe(own);
    }
  });
});

describe('identity outlives the name', () => {
  it('keeps the xray tag when the node, the host and the country are renamed', () => {
    // The whole point of the key: an operator editing a label must not move a
    // value routing rules dereference.
    const [e] = twoWaysIn();
    const renamed = { ...e!, nodeName: '🇩🇪 Frankfurt · main' } as SubscriptionEndpoint;
    expect(endpointTag(renamed)).toBe(endpointTag(e!));
  });

  it('separates two host rows of one binding', () => {
    const [a, b] = twoWaysIn();
    expect(endpointKey(a!)).not.toBe(endpointKey(b!));
    expect(endpointTag(a!)).not.toBe(endpointTag(b!));
  });

  it('falls back to what identifies an endpoint written out by hand', () => {
    const [a] = twoWaysIn();
    const keyless = { ...a!, key: undefined } as SubscriptionEndpoint;
    const otherPort = { ...keyless, port: 8443 } as SubscriptionEndpoint;
    expect(endpointKey(keyless)).toContain('ru1.example.com');
    expect(endpointTag(keyless)).not.toBe(endpointTag(otherPort));
  });
});
