/**
 * A MaxMind DB writer small enough for tests: record size 24, a search tree
 * built from the networks given, a data section of maps, strings, arrays and
 * unsigned integers, and the metadata mmdb-lib asks for. Spec:
 * https://maxmind.github.io/MaxMind-DB/ (search tree, data section, metadata).
 */

type Value = string | number | Value[] | { [k: string]: Value };

function ctrl(type: number, size: number): Buffer {
  const extended = type > 7;
  const head = (extended ? 0 : type) << 5;
  let sizeBits: number[];
  if (size < 29) sizeBits = [head | size];
  else if (size < 285) sizeBits = [head | 29, size - 29];
  else if (size < 65821) sizeBits = [head | 30, (size - 285) >> 8, (size - 285) & 0xff];
  else throw new Error('too big for a test');
  return Buffer.from(extended ? [sizeBits[0]!, type - 7, ...sizeBits.slice(1)] : sizeBits);
}

function encode(v: Value): Buffer {
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([ctrl(2, b.length), b]);
  }
  if (typeof v === 'number') {
    const bytes: number[] = [];
    for (let x = v; x > 0; x = Math.floor(x / 256)) bytes.unshift(x % 256);
    return Buffer.concat([ctrl(6, bytes.length), Buffer.from(bytes)]);
  }
  if (Array.isArray(v)) return Buffer.concat([ctrl(11, v.length), ...v.map(encode)]);
  const entries = Object.entries(v);
  return Buffer.concat([ctrl(7, entries.length), ...entries.flatMap(([k, x]) => [encode(k), encode(x)])]);
}

interface Trie {
  left?: Trie | number;
  right?: Trie | number;
}

/** `networks`: address bytes (4 or 16, matching `ipVersion`), prefix, and the
 *  record to find there. */
export function buildMmdb(
  ipVersion: 4 | 6,
  networks: { ip: number[]; prefix: number; data: Value }[],
): Buffer {
  const dataParts: Buffer[] = [];
  const dataOffsets: number[] = [];
  let dataSize = 0;
  for (const n of networks) {
    dataOffsets.push(dataSize);
    const b = encode(n.data);
    dataParts.push(b);
    dataSize += b.length;
  }

  // Leaves hold `-1 - dataIndex` until node numbers are known.
  const root: Trie = {};
  networks.forEach((n, i) => {
    let node = root;
    for (let d = 0; d < n.prefix; d++) {
      const bit = (n.ip[d >> 3]! >> (7 - (d & 7))) & 1;
      const side = bit ? 'right' : 'left';
      if (d === n.prefix - 1) {
        node[side] = -1 - i;
      } else {
        const next = node[side];
        if (typeof next !== 'object') node[side] = {};
        node = node[side] as Trie;
      }
    }
  });
  const order: Trie[] = [];
  const number = new Map<Trie, number>();
  const visit = (t: Trie) => {
    number.set(t, order.length);
    order.push(t);
    for (const side of ['left', 'right'] as const) {
      const c = t[side];
      if (typeof c === 'object') visit(c);
    }
  };
  visit(root);
  const nodeCount = order.length;
  const record = (c: Trie | number | undefined): number =>
    c === undefined ? nodeCount : typeof c === 'object' ? number.get(c)! : nodeCount + 16 + dataOffsets[-1 - c]!;
  const tree = Buffer.alloc(nodeCount * 6);
  order.forEach((t, i) => {
    tree.writeUIntBE(record(t.left), i * 6, 3);
    tree.writeUIntBE(record(t.right), i * 6 + 3, 3);
  });

  const metadata = encode({
    node_count: nodeCount,
    record_size: 24,
    ip_version: ipVersion,
    database_type: 'Iceslab-Test-Country',
    languages: ['en'],
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
    build_epoch: 1_700_000_000,
    description: { en: 'test' },
  });
  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    ...dataParts,
    Buffer.from('ABCDEF4D61784D696E642E636F6D', 'hex'),
    metadata,
  ]);
}

export const country = (iso: string) => ({ country: { iso_code: iso, names: { en: iso } } });
