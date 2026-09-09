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

  squadForm: {
    builtinSystemTooltip: 'Built-in squad: auto-tracks all inbounds',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    deployedTooltip: 'Deployed on nodes',
    profileOffBadge: 'off',
  },
} as const;
