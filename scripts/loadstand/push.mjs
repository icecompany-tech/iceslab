// A real push: one short id added to the profile, which every node of the fleet
// has to apply, with all its users handed out again after it. analyze.mjs reads
// how long that took.
//
//   node scripts/loadstand/push.mjs
//
// PANEL_URL comes from the environment, the token from .work/state.json.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const work = join(dirname(fileURLToPath(import.meta.url)), '.work');
const { profileId, token } = JSON.parse(readFileSync(join(work, 'state.json'), 'utf8'));
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const res = await fetch(`${process.env.PANEL_URL}/api/profiles/${profileId}`, { headers });
if (!res.ok) throw new Error(`read profile: ${res.status}`);
const profile = await res.json();
const config = {
  ...profile.config,
  realityShortIds: [...profile.config.realityShortIds, randomBytes(4).toString('hex')],
};
const put = await fetch(`${process.env.PANEL_URL}/api/profiles/${profileId}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ config }),
});
if (!put.ok) throw new Error(`write profile: ${put.status} ${(await put.text()).slice(0, 300)}`);
console.log(`pushed at ${Date.now()}`);
