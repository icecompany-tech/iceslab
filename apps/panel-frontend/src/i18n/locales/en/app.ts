export const app = {
  sidebar: {
    home: 'Home',
    users: 'Users',
    profiles: 'Profiles',
    squads: 'Squads',
    hosts: 'Hosts',
    nodes: 'Nodes',
    queues: 'Queues',
    queuesDesc: 'BullMQ overview',
    settings: 'Settings',
    logout: 'Log out',
    signedInAs: 'Signed in as',
    workspace: 'Workspace',
    subscriptionGroup: 'Subscription',
    subscriptionMetadata: 'Metadata',
    // Two names that used to be one: "Routes" decides where traffic goes once
    // it reaches the entry node, "Delivery" decides which config FORMAT a
    // client gets. Calling both of them Routing is what made every routing
    // conversation land on the wrong page.
    subscriptionRoutes: 'Routes',
    subscriptionDelivery: 'Delivery',
    subscriptionTemplates: 'Templates',
    subscriptionTemplate: 'Template',
    subscribePage: 'Subscribe page',
    infraBilling: 'Infra billing',
    trafficGroup: 'Traffic',
    // The door carries the same word as the three tabs behind it: node rules,
    // user rules, device rules. «Policies» shared no word with the screen.
    policies: 'Rules',
    torrentBlocker: 'Torrent Blocker',
    ruleSets: 'Rule sets',
    egress: 'Egress',
    dns: 'DNS',
    toolsGroup: 'Tools',
    hwidInspector: 'HWID inspector',
    srhInspector: 'SRH inspector',
    torrentBlockerReports: 'Torrent Blocker reports',
    sessionExplorer: 'Session explorer',
    httpStats: 'HTTP stats',
    // The row is drawn but the screen behind it doesn't exist yet. A hover
    // title, so a click that goes nowhere doesn't read as a broken link.
    notWired: 'Screen not built yet',
    // A word on the row itself, not only in a title: eight of these looked
    // exactly like the live rows, and nobody hovers a nav item to check.
    notWiredTag: 'no screen',
    systemGroup: 'System',
    insights: 'Insights',
    updateAvailable: 'Update available: {{version}}',
  },

  topbar: {
    support: 'Support',
  },
} as const;
