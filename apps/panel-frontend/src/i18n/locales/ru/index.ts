/**
 * Русский - base/native locale. Maps `keys.in.dot.notation` → strings.
 *
 * Convention: namespace by feature area (sidebar.users, nodes.create.title,
 * etc) so we can split files later without rename. Keep keys descriptive
 * enough that a missing translation defaults to a meaningful fallback.
 *
 * Split by contour: one file per group, this index only re-assembles them.
 * Keys, strings and nesting are untouched by the split.
 */
import { common } from './common';
import { app } from './app';
import { login } from './login';
import { dashboard } from './dashboard';
import { users } from './users';
import { nodes } from './nodes';
import { hosts } from './hosts';
import { profiles } from './profiles';
import { cascades } from './cascades';
import { squads } from './squads';
import { subscription } from './subscription';
import { settings } from './settings';

export default {
  ...common,
  ...app,
  ...login,
  ...dashboard,
  ...users,
  ...nodes,
  ...hosts,
  ...profiles,
  ...cascades,
  ...squads,
  ...subscription,
  ...settings,
};
