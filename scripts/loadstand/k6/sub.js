// Subscription requests in an open model: the rate is held whatever the panel
// answers, so a slow panel shows as latency and dropped iterations instead of
// quietly lowering the load.
//
//   MODE=steady RATE=13 DURATION=60m  the hourly poll of a cell
//   MODE=burst  RATE=13 BURST=79      that poll, then ten minutes of a burst
//   MODE=ramp   STEP=25 STEP_SECONDS=180 MAX=800
//                                     climbing, with the numbers per step
//
// A real client comes once an hour, so every request opens its own connection.
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL;
const MODE = __ENV.MODE || 'steady';
const RATE = Number(__ENV.RATE || 1);
const OUT = __ENV.OUT || '/work/sub-summary.json';
const STEP = Number(__ENV.STEP || 25);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 180);
const MAX = Number(__ENV.MAX || 800);
const RAMP_SECONDS = 10;

const devices = new SharedArray('devices', () =>
  open('/work/tokens.csv')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(',')),
);

// Shares of clients by format are a working assumption, in the report as such.
const FORMATS = [
  ['plain', 45],
  ['mihomo', 25],
  ['singbox', 20],
  ['xrayjson', 10],
];
const FORMAT_PICK = FORMATS.flatMap(([name, weight]) => Array(weight).fill(name));

const refused = new Counter('sub_not_200');

const steps = [];
for (let target = STEP; target <= MAX; target += STEP) steps.push(target);

function scenario() {
  if (MODE === 'ramp') {
    return {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      stages: steps.flatMap((target) => [
        { target, duration: `${RAMP_SECONDS}s` },
        { target, duration: `${STEP_SECONDS}s` },
      ]),
    };
  }
  if (MODE === 'burst') {
    const burst = Number(__ENV.BURST);
    return {
      executor: 'ramping-arrival-rate',
      startRate: RATE,
      timeUnit: '1s',
      stages: [
        { target: RATE, duration: '2m' },
        { target: burst, duration: '30s' },
        { target: burst, duration: '60s' },
        { target: RATE, duration: '30s' },
        { target: RATE, duration: '7m' },
      ],
    };
  }
  return { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '5m' };
}

// A threshold that always passes is how k6 is told to keep a tagged sub-metric
// in the summary.
const keep = {};
for (const [name] of FORMATS) keep[`http_req_duration{format:${name}}`] = ['max>=0'];
if (MODE === 'ramp') {
  for (const target of steps) {
    keep[`http_req_duration{step:${target}}`] = ['max>=0'];
    keep[`http_reqs{step:${target}}`] = ['count>=0'];
    keep[`sub_not_200{step:${target}}`] = ['count>=0'];
  }
}

export const options = {
  noVUConnectionReuse: true,
  discardResponseBodies: true,
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    sub: { ...scenario(), preAllocatedVUs: Number(__ENV.VUS || 200), maxVUs: Number(__ENV.MAX_VUS || 2000) },
  },
  thresholds: keep,
};

// The target of the stage this moment falls in; requests on the way up to it
// count towards it too.
function stepNow() {
  const elapsed = exec.instance.currentTestRunDuration / 1000;
  const index = Math.floor(elapsed / (RAMP_SECONDS + STEP_SECONDS));
  return String(steps[Math.min(index, steps.length - 1)]);
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const [token, hwid] = devices[i % devices.length];
  const format = FORMAT_PICK[i % FORMAT_PICK.length];
  const tags = { format, name: 'sub', ...(MODE === 'ramp' ? { step: stepNow() } : {}) };
  const res = http.get(`${BASE_URL}/sub/${token}?format=${format}`, {
    headers: { 'user-agent': 'Happ/3.8.1', 'x-hwid': hwid },
    tags,
  });
  if (res.status !== 200) refused.add(1, { status: String(res.status), ...tags });
}

export function handleSummary(data) {
  return { [OUT]: JSON.stringify(data) };
}
