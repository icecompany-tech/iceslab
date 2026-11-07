// Prints the numbers of one k6 summary file, per format and per ramp step where
// it has them.
//   node scripts/loadstand/summary.mjs <summary.json>
import { readFileSync } from 'node:fs';

const { metrics, state } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ms = (x) => (x === undefined ? '-' : x.toFixed(1));

function trend(name, m) {
  if (!m) return;
  const v = m.values;
  console.log(`${name}: p50=${ms(v.med)} p95=${ms(v['p(95)'])} p99=${ms(v['p(99)'])} max=${ms(v.max)} ms`);
}

const seconds = state.testRunDurationMs / 1000;
const reqs = metrics.http_reqs?.values.count ?? 0;
console.log(`duration=${seconds.toFixed(0)}s requests=${reqs} rate=${(reqs / seconds).toFixed(1)}/s`);
console.log(`not_200=${metrics.sub_not_200?.values.count ?? 0} failed=${metrics.http_req_failed?.values.passes ?? 0} dropped=${metrics.dropped_iterations?.values.count ?? 0} vus_max=${metrics.vus_max?.values.max ?? '-'}`);
trend('all', metrics.http_req_duration);
for (const [name, m] of Object.entries(metrics)) {
  const tagged = /^http_req_duration\{format:(.+)\}$/.exec(name);
  if (tagged) trend(tagged[1], m);
}

const steps = Object.keys(metrics)
  .map((name) => /^http_req_duration\{step:(\d+)\}$/.exec(name)?.[1])
  .filter(Boolean)
  .sort((a, b) => Number(a) - Number(b));
for (const step of steps) {
  const done = metrics[`http_reqs{step:${step}}`]?.values.count ?? 0;
  if (done === 0) continue;
  const bad = metrics[`sub_not_200{step:${step}}`]?.values.count ?? 0;
  const v = metrics[`http_req_duration{step:${step}}`].values;
  console.log(`step=${step}/s done=${done} not_200=${bad} p50=${ms(v.med)} p95=${ms(v['p(95)'])} p99=${ms(v['p(99)'])} max=${ms(v.max)} ms`);
}
