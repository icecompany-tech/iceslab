// What an operator opens while the background load runs, one request a second:
// the users list on the first and a deep page, a search, the dashboard and nodes.
//
//   RATE=1 DURATION=60m
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL;
const state = JSON.parse(open('/work/state.json'));
const headers = { authorization: `Bearer ${state.token}` };
const DEEP_PAGE = Number(__ENV.DEEP_PAGE || 1000);

const SCREENS = [
  ['users-first', '/api/users?page=1&limit=25'],
  ['users-deep', `/api/users?page=${DEEP_PAGE}&limit=25`],
  ['users-search', '/api/users?page=1&limit=25&search=b2u1234'],
  ['dashboard', '/api/dashboard/overview'],
  ['nodes', '/api/nodes?page=1&limit=50'],
];

const refused = new Counter('screen_not_200');

export const options = {
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    screens: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 1),
      timeUnit: '1s',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: Object.fromEntries(SCREENS.map(([name]) => [`http_req_duration{screen:${name}}`, ['max>=0']])),
};

export default function () {
  const [name, path] = SCREENS[exec.scenario.iterationInTest % SCREENS.length];
  const res = http.get(`${BASE_URL}${path}`, { headers, tags: { screen: name, name } });
  if (res.status !== 200) refused.add(1, { screen: name, status: String(res.status) });
}

export function handleSummary(data) {
  return { [__ENV.OUT || '/work/screens-summary.json']: JSON.stringify(data) };
}
