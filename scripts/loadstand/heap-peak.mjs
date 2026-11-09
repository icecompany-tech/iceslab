// The peak of the backend's V8 heap, from the --trace-gc lines in its log (the
// stand's compose runs it with that flag). Each line gives the heap before and
// after a collection, so the largest "before" is the peak to within one cycle.
//
//   docker logs iceslab-prod-backend 2>&1 | node scripts/loadstand/heap-peak.mjs
import { createInterface } from 'node:readline';

const GC = /(Scavenge|Mark-Compact|Mark-sweep)[^\d]*?([\d.]+) \(([\d.]+)\) -> ([\d.]+) \(([\d.]+)\) MB/;

let peak = 0;
let reserved = 0;
let afterFull = 0;
let collections = 0;
let full = 0;
let crashes = 0;

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.includes('heap out of memory')) crashes++;
  const m = GC.exec(line);
  if (!m) continue;
  collections++;
  peak = Math.max(peak, Number(m[2]));
  reserved = Math.max(reserved, Number(m[3]));
  if (m[1] !== 'Scavenge') {
    full++;
    afterFull = Math.max(afterFull, Number(m[4]));
  }
}

console.log(
  `heap peak=${peak.toFixed(0)} MB, reserved=${reserved.toFixed(0)} MB, ` +
    `largest live after a full collection=${afterFull.toFixed(0)} MB, ` +
    `collections=${collections} (full ${full}), heap crashes=${crashes}`,
);
