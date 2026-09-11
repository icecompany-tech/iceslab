import { prisma } from '../../src/prisma.js';
import { _resetBindingsCacheForTest } from '../../src/modules/subscription/subscription.bindings-cache.js';
import { invalidateSubscriptionSettingsCache } from '../../src/modules/settings/settings.service.js';

// Listed in the order they need truncating. CASCADE handles FKs but explicit
// listing is documentation. Anything that references another table comes first.
export const TABLES = [
  // A4 ad-split. Missing here until 2026-07-30, which nothing noticed while the
  // module was read-only: policies are unique on both name and ordinal, so the
  // first test that CREATED one poisoned every later case in the same run.
  'group_route_policies',
  'route_policies',
  // Э3 layer B. Rules before policies: the FK cascades either way, but the
  // order here is documentation. Both listed the day the tables landed, because
  // the last two omissions from this list (route_policies, app_settings) each
  // cost a debugging session where one test decided another's outcome.
  'node_policy_rules',
  'node_policies',
  'group_cascade_exits',
  'cascade_hops',
  // v4 topology. These hang off `cascades` and were being cleared implicitly by
  // the CASCADE on the truncate; listed now because "implicitly handled" is
  // invisible, and the day one of them loses its FK nothing would say so.
  'cascade_links',
  'cascade_direction_nodes',
  'cascade_directions',
  'cascade_position_nodes',
  'cascade_positions',
  'cascades',
  'amneziawg_peers',
  'subscription_events',
  'subscription_request_history',
  'subscription_response_rules',
  'node_user_usage_history',
  'node_usage_history',
  'group_members',
  'group_profiles',
  'group_hosts',
  'group_inbounds',
  'groups',
  'hwid_user_devices',
  'user_traffic',
  'users',
  'hosts',
  'profile_node_bindings',
  'profiles',
  'inbounds',
  'node_bootstrap_tokens',
  // Two of the additions here were REAL leaks, not bookkeeping. Nothing
  // cascades into either, so rows survived every truncate:
  //   - node_user_traffic_snapshot has no FK at all, on purpose (the hot stats
  //     path must not join), so a snapshot written by one test was still there
  //     to be billed against in the next;
  //   - regions is referenced by nodes with SET NULL, so truncating nodes left
  //     the regions behind, and `name` and `code` are both unique.
  'node_user_traffic_snapshot',
  'nodes',
  'regions',
  'api_tokens',
  'keygen_ca',
  'admin_users',
  // Missing here until 2026-09-11, and it leaked ACROSS FILES rather than
  // within one: files run serially in one process, so a settings row written by
  // an earlier file was still there for every later one. The entry-pool file
  // sets subscriptionEntryPoolSize, and the next file's subscription therefore
  // capped its endpoints and handed back fewer lines than the test created
  // nodes. It looked like a flake because it depends on file ORDER, so it
  // appeared when files were added and disappeared when the failing test was
  // run on its own.
  'app_settings',
];

export async function cleanDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
  // B6 - the squad-set binding cache is in-process and survives a DB truncate.
  // The "All" squad below is re-seeded with a FIXED id, so without this reset a
  // later test that creates no bindings (fires no bust event) would be served a
  // prior test's cached binding-set under the same key. Treat truncation as the
  // ultimate out-of-band change and clear the cache here, per test.
  _resetBindingsCacheForTest();
  // Same reasoning one table over: the settings DTO is cached in-process for a
  // minute, so truncating app_settings above would otherwise leave the previous
  // file's values being served from memory for the rest of the run.
  invalidateSubscriptionSettingsCache();
  // Re-seed the "All" squad, slice 26 wired user-create to default to it,
  // so an empty groups table makes every user-create fail with FK violation.
  // The seed migration installs this row in production; tests truncate it
  // away each turn and need it back before the next case runs.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "groups" (id, name, description, created_at, updated_at)
    VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'All',
      'Default group containing every inbound. Auto-membership for new users.',
      NOW(),
      NOW()
    )
  `);
}
