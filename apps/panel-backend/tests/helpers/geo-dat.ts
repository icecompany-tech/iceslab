/**
 * Hand-built v2fly geo files for tests: a few lines of protobuf encoding, so a
 * test can say exactly which bytes it feeds the reader. Schema in
 * src/modules/geo-sets/geo-dat.ts.
 */

const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const key = (field: number, wire: number) => varint(field * 8 + wire);

export const bytes = (field: number, b: number[]) => [...key(field, 2), ...varint(b.length), ...b];
export const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
export const int = (field: number, v: number) => [...key(field, 0), ...varint(v)];

export const PLAIN = 0;
export const REGEX = 1;
export const ROOT = 2;
export const FULL = 3;

export const domain = (type: number, value: string, attrs: string[] = []) =>
  bytes(2, [...int(1, type), ...str(2, value), ...attrs.flatMap((a) => bytes(3, [...str(1, a), ...int(2, 1)]))]);
export const site = (code: string, ...domains: number[][]) => bytes(1, [...str(1, code), ...domains.flat()]);
export const cidr = (ip: number[], prefix: number) => bytes(2, [...bytes(1, ip), ...int(2, prefix)]);
export const geoip = (code: string, ...cidrs: number[][]) => bytes(1, [...str(1, code), ...cidrs.flat()]);
export const datFile = (...entries: number[][]) => Uint8Array.from(entries.flat());
