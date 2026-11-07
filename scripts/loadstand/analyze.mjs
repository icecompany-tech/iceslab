// Reads synth-agent's event log for one scenario and answers what the untouched
// panel cannot say about itself: how long a poll cycle takes, whether cycles were
// missed, how long a push took to reach the fleet, how many times a user was sent
// off the nodes, and how long a sale took to reach them.
//
//   node scripts/loadstand/analyze.mjs <events.ndjson> <raw/label directory>
//
// The directory gives the scenario's window (probe.sh) and the logs of
// k6/sales.js, any file named sales*.log.
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [eventsPath, rawDir] = process.argv.slice(2);
if (!eventsPath || !rawDir) {
  console.error('usage: analyze.mjs <events.ndjson> <raw/label directory>');
  process.exit(2);
}

const since = Number(readFileSync(join(rawDir, 'started.txt'), 'utf8')) * 1000;
const until = Number(readFileSync(join(rawDir, 'stopped.txt'), 'utf8')) * 1000;

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function line(name, values) {
  const s = [...values].sort((a, b) => a - b);
  console.log(`${name}: n=${s.length} p50=${pct(s, 50)} p95=${pct(s, 95)} p99=${pct(s, 99)} max=${s.at(-1) ?? null}`);
}

const sent = new Map();
for (const file of readdirSync(rawDir).filter((f) => /^sales.*\.log$/.test(f))) {
  for (const raw of readFileSync(join(rawDir, file), 'utf8').split('\n')) {
    // k6 wraps the console line in its own log line, escaping the quotes.
    const match = /\\?"op\\?":\\?"add\\?",\\?"t\\?":(\d+),\\?"u\\?":\\?"([0-9a-f-]{36})/.exec(raw);
    if (match) sent.set(match[2], Number(match[1]));
  }
}

const pollsByNode = new Map();
const statsUsers = [];
const counts = { add: 0, remove: 0, apply: 0, stats: 0 };
const firstSeen = new Map();
const seenBy = new Map();
const removesByUser = new Map();
const nodes = new Set();
let firstApply = null;
let lastAdd = null;

const lines = createInterface({ input: createReadStream(eventsPath), crlfDelay: Infinity });
for await (const raw of lines) {
  // The fleet may still be writing: its last line can be cut at a flush.
  if (!raw.endsWith('}')) continue;
  const ev = JSON.parse(raw);
  if (ev.t < since || ev.t > until) continue;
  nodes.add(ev.n);
  counts[ev.e] = (counts[ev.e] ?? 0) + 1;
  if (ev.e === 'stats') {
    if (!pollsByNode.has(ev.n)) pollsByNode.set(ev.n, []);
    pollsByNode.get(ev.n).push(ev.t);
    statsUsers.push(ev.c);
  }
  if (ev.e === 'apply' && firstApply === null) firstApply = ev.t;
  if (ev.e === 'add') {
    if (firstApply !== null) lastAdd = ev.t;
    if (sent.has(ev.u)) {
      if (!firstSeen.has(ev.u)) firstSeen.set(ev.u, ev.t);
      seenBy.set(ev.u, ev.t);
    }
  }
  if (ev.e === 'remove') removesByUser.set(ev.u, (removesByUser.get(ev.u) ?? 0) + 1);
}

console.log(`window: ${(until - since) / 1000}s, events: ${JSON.stringify(counts)}`);

const gaps = [];
for (const polls of pollsByNode.values()) {
  for (let i = 1; i < polls.length; i++) gaps.push(polls[i] - polls[i - 1]);
}
line('stats poll interval per node, ms (30000 when no cycle is late)', gaps);
line('users in one /stats answer', statsUsers);

// All nodes answer inside one cycle, so the spread of a cycle's arrivals bounds
// how long the panel took to reach the fleet. Cycles start on :00 and :30, and
// rounding keeps an arrival just before the mark in the cycle it belongs to.
const spread = new Map();
for (const polls of pollsByNode.values()) {
  for (const t of polls) {
    const slot = Math.round(t / 30000);
    const cur = spread.get(slot) ?? [t, t];
    spread.set(slot, [Math.min(cur[0], t), Math.max(cur[1], t)]);
  }
}
line('spread of a poll cycle over the fleet, ms', [...spread.values()].map(([a, b]) => b - a));

if (firstApply !== null && lastAdd !== null) {
  console.log(`push: first apply to last user added ${lastAdd - firstApply} ms, ${counts.add} additions`);
}

if (removesByUser.size > 0) {
  const perNode = [...removesByUser.values()].map((n) => n / Math.max(nodes.size, 1));
  line(`times a user was sent off the fleet (${removesByUser.size} users)`, perNode);
}

if (sent.size > 0) {
  const delays = [...firstSeen].map(([u, t]) => t - sent.get(u));
  const finals = [...seenBy].map(([u, t]) => t - sent.get(u));
  console.log(`sold: ${sent.size}, reached a node: ${firstSeen.size}`);
  line('sale to first node, ms', delays);
  line('sale to last node, ms', finals);
}
