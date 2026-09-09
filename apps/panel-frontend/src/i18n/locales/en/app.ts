export const app = {
  sidebar: {
    home: 'Home',
    users: 'Users',
    profiles: 'Profiles',
    squads: 'Squads',
    hosts: 'Hosts',
    nodes: 'Nodes',
    cascades: 'Cascades',
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
    subscriptionTemplate: 'Template',
    subscribePage: 'Subscribe page',
    infraBilling: 'Infra billing',
    trafficGroup: 'Traffic',
    policies: 'Policies',
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
    systemGroup: 'System',
    insights: 'Insights',
    updateAvailable: 'Update available: {{version}}',
  },

  topbar: {
    support: 'Support',
  },
} as const;
