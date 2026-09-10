export const COL = {
  status: 140,
  // Holds `lastOnlineAt`. It was called subscription and headed Subscription,
  // which read as "the subscription was fetched 23s ago". The panel does not
  // record that anywhere, so the name had to go with the heading.
  lastOnline: 140,
  expires: 140,
  traffic: 260,
  squads: 200,
  tag: 100,
  actions: 56,
} as const;
