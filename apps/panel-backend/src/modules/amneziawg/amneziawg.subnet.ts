// Pure CIDR helpers for AmneziaWG IP allocation. IPv4 only, IPv6 inbounds
// can be added later without affecting this contract.

export interface SubnetRange {
  base: number;
  prefix: number;
  serverIp: number;
  firstUsable: number;
  lastUsable: number;
}

export function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255 || p === '') {
      throw new Error(`Invalid octet in ${ip}`);
    }
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

// Reserves three addresses inside the subnet:
//   .0   network
//   .1   server / gateway (the awg interface itself)
//   .255 (or last) broadcast
// Everything else is handed to peers.
export function parseSubnet(cidr: string): SubnetRange {
  const slash = cidr.indexOf('/');
  if (slash < 1) throw new Error(`Invalid CIDR: ${cidr}`);
  const ipStr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error(`Invalid prefix /${prefix} (must be /8..30)`);
  }
  const baseRaw = ipToInt(ipStr);
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const base = (baseRaw & mask) >>> 0;
  const broadcast = (base | (~mask >>> 0)) >>> 0;
  const serverIp = base + 1;
  const firstUsable = serverIp + 1;
  const lastUsable = broadcast - 1;
  if (firstUsable > lastUsable) {
    throw new Error(`Subnet ${cidr} too small to host any peers`);
  }
  return { base, prefix, serverIp, firstUsable, lastUsable };
}
