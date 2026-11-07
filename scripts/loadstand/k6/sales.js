// Sales: users created and deleted at a steady rate through the API, the way a
// bot does it. Each operation goes to the log with its time, so analyze.mjs can
// pair it with the moment it reached the nodes (same clock as synth-agent).
//
//   PER_MINUTE=100 DURATION=60m
import http from 'k6/http';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL;
const state = JSON.parse(open('/work/state.json'));
const headers = { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' };
const run = Date.now().toString(36);

export const options = {
  noConnectionReuse: false,
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    sales: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.PER_MINUTE || 100),
      timeUnit: '1m',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
  },
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const sent = Date.now();
  const res = http.post(
    `${BASE_URL}/api/users`,
    JSON.stringify({
      username: `b2s-${run}-${n}`,
      groupIds: [state.squads[n % state.squads.length]],
      enabledProtocols: ['xray'],
    }),
    { headers, tags: { name: 'create' } },
  );
  if (res.status !== 201) {
    console.error(JSON.stringify({ op: 'create', status: res.status, body: String(res.body).slice(0, 200) }));
    return;
  }
  const id = res.json('id') || res.json('user.id');
  console.log(JSON.stringify({ op: 'add', t: sent, u: id }));
}

export function handleSummary(data) {
  return { [__ENV.OUT || '/work/sales-summary.json']: JSON.stringify(data) };
}
