export const squads = {
  squads: {
    title: 'Internal squads',
    subtitle: 'Group ACL: which inbounds each user sees in their subscription',
    create: 'Create squad',
    bar: {
      squads: 'SQUADS',
      members: 'MEMBERS',
      withoutHosts: 'WITHOUT HOSTS',
    },
    card: {
      system: 'SYSTEM',
      hosts: 'HOSTS',
      members: 'MEMBERS',
      // A squad is narrowed by direction, not by the node a direction points
      // at, so the column is named after what it actually restricts.
      exitsPolicies: 'DIRECTIONS · POLICIES',
      noneGranted: 'none granted',
      allExits: 'all',
      of: 'of',
      noPolicies: 'none',
      grantHosts: 'Grant hosts',
    },
    refresh: 'Refresh',
    open: 'Open',
    searchPlaceholder: 'Search by name or description…',
    empty: 'No squads.',
    allDefaultName: 'All',
    allDefaultDescription: 'Default group; new users join automatically.',
    deleteTitle: 'Delete squad "{{name}}"?',
    deleteBody: 'Users stay, but lose access to profiles bound to this squad. Users with no other squad get re-added to All.',
    deleteAllProtected: 'Squad "All" is system-protected and cannot be deleted.',
    notify: {
      created: 'Squad created',
      updated: 'Squad updated',
      deleted: 'Squad deleted',
    },
    form: {
      titleCreate: 'Create squad',
      titleEdit: 'Edit squad',
      name: 'Name',
      namePlaceholder: 'Trial / VIP / Stage',
      description: 'Description',
      descriptionPlaceholder: 'What this group is for (optional)',
      routing: 'Routing override',
      routingDesc: 'Subscription routing for this squad. Inherit = use the panel-wide setting.',
      // Per-preset labels live under `metadata.preset*`: every picker builds its
      // options from the shared id list and translates them from one place.
      routingInherit: 'Inherit (panel default)',
      hwidLimit: 'HWID device limit (squad default)',
      hwidLimitDesc: 'Default device cap for members without their own limit. Empty = none. Across squads the most-permissive (max) wins.',
      hwidLimitPlaceholder: 'No squad default',
      profiles: 'Profiles',
      profilesSelected: '{{count}} selected',
      profilesSearch: 'Search by name / protocol…',
      profilesEmpty: 'No profiles in the system yet.',
      profilesNothingFound: 'Nothing found.',
      exitAcl: 'Cascade exits',
      exitAclHint:
        'Restrict which balancer exits this squad can use. Leave a cascade with none checked to allow all its exits.',
      exitAclAll: 'all',
      policies: 'Route policies',
      policiesHint:
        'Grant ad-split policies to this squad. The plain profile is always available; each granted policy adds a variant per exit (e.g. "CH · No ads").',
      submitCreate: 'Create',
      submitEdit: 'Save',
      systemSquadTooltip: 'System squad',
      profilesSelectedBadge: 'Profiles selected',
      membersBadge: 'Members',
      allAlert:
        "All is the system squad. Auto-attached to every new profile and every new user. It cannot be renamed, edited, or deleted.",
    },
  },

  squadEdit: {
    unsaved: 'UNSAVED CHANGES',
    builtInReadOnly: 'BUILT-IN · READ-ONLY',
    locked: 'LOCKED',
    close: 'Close',
    notFound: 'This squad no longer exists.',
    backToList: 'Back to squads',
    newTitle: 'New squad',
    newCrumb: 'NEW',
    namePlaceholder: 'Trial / VIP / Stage',
    descriptionPlaceholder: 'What this group is for (optional)',
    hwidPlaceholder: 'Not set',
    hwidHintNew: 'Leave empty to fall back to the panel default.',
    draft: 'DRAFT · NOT SAVED',
    membersLater: 'Members join after the squad exists',
    membersShort: 'members',
    assignLater: 'Assign users after saving',
    emptyWarning: 'A squad without hosts gives its members nothing. Pick at least one before you create it.',
    previewEmptyTitle: 'Nothing to show yet',
    previewEmptyBody: 'Pick hosts on the left and the resulting lines appear here.',
    selectAll: 'Select all',
    optional: 'OPTIONAL',
    allTitle: 'All is the system squad, it cannot be renamed, edited or deleted.',
    allBody:
      'Every new host is attached to it and every new user joins it, so this page is the read-only baseline of the whole panel.',
    basics: 'Basics',
    name: 'Name',
    nameHint: 'Shown to operators only, never to members.',
    description: 'Description',
    descriptionHint: 'Optional note about what this group is for.',
    routingOverride: 'Routing override',
    routingInherit: 'Inherit (panel default)',
    routingHint: 'Inherit keeps the panel-wide subscription routing.',
    hwidLimit: 'HWID device limit',
    devices: 'devices',
    hwidHint: 'Squad default. Across squads the most permissive wins.',
    profiles: 'Profiles',
    profilesHint:
      'What this squad grants. Everything below narrows within these: a host of a profile the squad does not hold cannot be handed out.',
    profilesAll:
      'The system squad holds every profile, including ones added later, and that cannot be changed.',
    allProfiles: 'ALL PROFILES',
    grantedOf: '{{count}} of {{total}} granted',
    noProfiles: 'No profiles configured yet.',
    noProfilesGranted:
      'No profiles granted. Members of this squad get an empty subscription until you tick at least one.',
    profileNodes_one: '{{count}} node',
    profileNodes_other: '{{count}} nodes',
    hosts: 'Hosts',
    selected: '{{count}} selected',
    selectedOf: '{{count}} of {{total}} handed out',
    attachedAll: '{{count}} attached · all of them',
    restrict: 'Restrict',
    clearRestriction: 'Hand out all',
    noRestriction:
      'No restriction: this squad hands out every host of its profiles, including ones added later. Use Restrict to narrow it.',
    // Sending an empty list would lift the restriction instead of tightening it,
    // so this state is shown and refused rather than silently reinterpreted.
    nothingPicked:
      'This squad hands out no hosts. Tick the ones it should reach, or press Hand out all.',
    hostOff: 'OFF',
    entryNotHandedOut:
      'The entry is not handed out, so no direction rides out. Directions travel on the entry line itself.',
    allDirections: 'ALL DIRECTIONS',
    cascadeDirectionsAll:
      'The system squad never restricts directions. Members reach every direction its cascades carry.',
    routePoliciesAll:
      'No policies are granted to All, so members get the plain variant of every host. Grant policies in a regular squad instead.',
    policiesExistNoneApply: '{{count}} policies exist in the panel, none apply here',
    collapseAll: 'Collapse all',
    hostSearch: 'Search by name / port / profile...',
    noHosts: 'No hosts deployed yet.',
    // The ticks used to be an indicator of what the profiles already reached.
    // They are a choice now, so the hint says which mode is in play.
    treeHintAll:
      'Click a country row to fold it away. Every host of the granted profiles goes out, so the ticks state a fact rather than a choice.',
    treeHintRestricted:
      'Click a country row to fold it away. Ticked hosts are the ones this squad hands out; hosts added later stay out until you tick them.',
    // A squad is narrowed by direction, and a direction is identified by its
    // tag. The node under it can be swapped without any of this changing.
    cascadeDirections: 'Cascade directions',
    cascadeDirectionsHint:
      'Restrict which cascade directions this squad sees. None checked means every direction. Tags run plain first, then one per granted policy.',
    noDirections: 'No cascade carries more than one direction yet.',
    exit: 'exit',
    routePolicies: 'Route policies',
    routePoliciesHint:
      'Grant ad-split policies to this squad. The plain variant is always available, each granted policy adds one more variant per exit.',
    blocksDomains: 'blocks {{count}} domains',
    bypassesDomains: 'bypasses {{count}} domains',
    whatMembersGet: 'What members get',
    lines: 'lines',
    hostsWord_one: 'host',
    hostsWord_other: 'hosts',
    variantsWord_one: 'variant',
    variantsWord_other: 'variants',
    previewNote:
      'Hosts and their variants only. Cascade directions live in the block above, that is a different mechanic.',
    membersAffected: 'members affected',
    plainOnly: 'plain',
    plainPlus: 'plain +{{count}}',
  },

  squadForm: {
    builtinSystemTooltip: 'Built-in squad: auto-tracks all inbounds',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    deployedTooltip: 'Deployed on nodes',
    profileOffBadge: 'off',
  },
} as const;
