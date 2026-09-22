export const subscription = {

  // The two tabs of one «Subscription settings». The names say what a tab
  // EDITS rather than what the section is called: the sidebar item "Delivery"
  // already belongs to the User-Agent rule list, and a second one would read
  // as the same place.
  settingsTabs: {
    metadata: 'Metadata',
    delivery: 'Format and address',
    dirtyTitle: 'This tab has unsaved edits',
    dirtyBody: 'The other tab is a separate page: it loads afresh and the edits are gone.',
    dirtyStay: 'Stay here',
    dirtyLeave: 'Leave without saving',
  },

  // Delivery settings: what a person opening the link gets, and in what shape.
  // A separate key from `delivery`, which is the User-Agent rule list.
  deliverySetup: {
    // Not «Delivery»: that word names the sidebar item holding the User-Agent
    // rule list, and two identical titles would read as one place.
    title: 'Delivery format and address',
    subtitle: 'What a person opening the link gets, and in what shape it reaches their client.',
    saving: 'Saving',
    saved: 'Delivery settings saved',

    formatTitle: 'Default format',
    formatHint: 'What goes out when a client opened the plain link and picked nothing.',

    shapeTitle: 'Shape of delivery',
    shapeHint: 'One server per line, or a separate line for each protocol of that server.',
    shapePerNode: 'One config per server',
    shapePerNodeNote:
      'A short list. If a server has several inbounds the lines become identical and nobody can tell them apart.',
    shapePerExit: 'A config per exit',
    shapePerExitNote:
      'A longer list, but every line differs from its neighbour and can be picked on purpose. The label comes from the node name and the protocol.',

    deadTitle: 'Wording for a subscription that is not in force',
    deadHint: 'What a person reads when they cannot connect. Empty means our own text is used.',
    dead: {
      expired: 'Ran out',
      limited: 'Allowance used up',
      disabled: 'Switched off',
    },
    // As a placeholder, not a value: an empty box must read as «leave it as it
    // is», never as «erase the text».
    deadDefault: {
      expired: 'The subscription has run out. Renew it and this page works again, with the same link.',
      limited: 'The traffic allowance is used up. Access resumes when the allowance is renewed.',
      disabled: 'The subscription is switched off. Your operator can switch it back on.',
    },

    addressTitle: 'Delivery address',
    addressHint: 'Clients fetch their config from here. Changed rarely, breaks painfully.',
    publicHost: 'Public domain',
    pathPrefix: 'Path prefix · read only',
    pathPrefixWhy:
      'Set in the environment: the route is registered with this prefix at boot, and the panel cannot change it.',
    activeCountWarn:
      'subscriptions in force were issued on this address. Changing the domain does not rewrite their links: they keep going to the old host for as long as it points at the panel.',

    probe: 'Check',
    probing: 'Checking',
    probeOk: 'The address answers the panel',
    probeBad: 'The address could not be reached',
    probeFailed: 'The check did not run',
    probeCode: 'Code',
    probeMs: 'Answer',
    probeTls: 'TLS',
    probeUrl: 'Address checked',

    previewTitle: 'Page preview',
    previewHint:
      'The real page on a temporary token with invented data, carrying the wording and the format from these settings. The link lives fifteen minutes.',
    previewOpen: 'Open in a new tab',
    previewState: {
      active: 'active',
      expiring: 'expiring',
      expired: 'expired',
      limited: 'limited',
      disabled: 'disabled',
    },
  },

  // Delivery: which config FORMAT each client app is served. One page for the
  // rule list, one for writing a rule.
  delivery: {
    title: 'Delivery',
    subtitle:
      'First rule whose regex matches the client User-Agent wins, the catch-all sits last.',
    factRules: 'rules',
    factEnabled: 'enabled',
    create: 'Create rule',
    created: 'Rule created',
    updated: 'Rule updated',
    deleted: 'Rule deleted',
    saving: 'Saving...',
    gone: 'This rule no longer exists.',
    empty: 'No rules yet. Every client gets the endpoint default until you write one.',
    colPriority: 'Priority',
    colName: 'Name',
    colPattern: 'UA pattern',
    colFormat: 'Format',
    colEnabled: 'Enabled',
    catchAll: 'Catch-all',
    deleteTitle: 'Delete rule "{{name}}"?',
    deleteBody: 'Clients it used to catch fall through to the next matching rule.',
    testTitle: 'Test a User-Agent',
    testHint: 'Runs the same matcher the subscription endpoint uses, nothing is saved.',
    testButton: 'Test',
    testMatch: 'Matches rule {{priority}} {{name}}',
    testShadowed_one: '{{count}} rule below never runs for it',
    testShadowed_other: '{{count}} rules below never run for it',
    testNoMatch: 'No rule matches. The endpoint falls back to its own default.',
    howTitle: 'How matching works',
    how1: 'Rules run in priority ascending order, the first regex that matches the User-Agent wins.',
    how2: 'A disabled rule is skipped entirely, it does not block lower priorities.',
    how3: 'Keep the catch-all last. Without it a client with an unknown UA gets the endpoint default.',
    formatsTitle: 'Formats',
    format: {
      plain: 'base64 URI list, works everywhere, no routing',
      xrayjson: 'single Xray config with routing and fragment',
      singbox: 'sing-box config for Hiddify and friends',
      clash: 'Clash YAML with proxy groups and rules',
      xkeen: 'router flavour of the Xray config',
      wgconf: 'wg-quick file, AmneziaWG hosts only',
      outline: 'Outline / SIP008, Shadowsocks only',
      surge: 'Surge profile',
      quantumultx: 'Quantumult X profile',
      loon: 'Loon profile',
      json: 'the panel\'s own structured JSON',
      'xrayjson-array': 'array topology, one entry per server, Happ style',
    },
    // The rule editor.
    crumbNew: 'New rule',
    newTitle: 'New delivery rule',
    newSubtitle: 'Which client · which format',
    catchAllWarn: 'Catches everything',
    whoTitle: 'Who it catches',
    fieldName: 'Name',
    fieldNameHint: 'For you only, a subscriber never sees it.',
    fieldPriority: 'Priority',
    fieldPriorityHint: 'Lower runs earlier.',
    fieldPattern: 'User-Agent regex',
    fieldPatternHint: '(?i) at the front means case-insensitive. Tested against the whole header.',
    patternInvalid: 'This is not a regex the panel can compile, so it would be refused on save.',
    fieldEnabled: 'Enabled',
    fieldEnabledHint: 'A disabled rule is skipped entirely and blocks nothing below it.',
    whatTitle: 'What it serves',
    whatHint: 'Exactly one format per rule',
    keepsExits: 'Keeps cascade exits',
    tryTitle: 'Try it now',
    tryHit: 'This rule catches that client',
    tryMiss: 'This rule does not catch that client',
    overlapTitle: 'Overlap',
    overlapIdle: 'Type a User-Agent above and this says which rule would win it.',
    overlapClear: 'No earlier rule catches that User-Agent, so this one wins it.',
    overlapShadowed:
      'Rule {{priority}} {{name}} with pattern {{pattern}} runs first and catches that User-Agent, so this rule never sees it.',
    overlapTie:
      '{{name}} also sits at priority {{priority}}. Two rules at the same priority have no defined order between them.',
    overlapNote:
      'This is a check against the sample above, not a verdict: two patterns can overlap on one client and not on another, so the panel warns rather than refusing the save.',
    scopeNote:
      'A rule decides the SHAPE of the config only. Where the traffic goes is decided by the routing preset and the routes, on their own pages.',
  },
  // Delivery templates, phase 11. "The server cannot do this yet" and "you have
  // no templates" are different screens and different words: the first is about
  // the panel, the second about the operator's work.
  templates: {
    title: 'Delivery templates',
    count: '{{n}} templates',
    create: 'Create',
    serves: 'served as {{format}}',
    defaultTag: 'default',
    edited: 'edited {{when}}',
    soonTitle: 'Arrives with phase 11',
    soonBody:
      'A template is a whole client config that the panel drops your servers into: your groups, your rules, your profile name. The screen is here, the template store on the server is not, so an empty list is not because you created nothing.',
    // The editor for one template.
    newTitle: 'New template',
    gone: 'This template no longer exists.',
    saving: 'Saving...',
    type: 'Type',
    typeHintNew: 'Decides the frame, the insertion slot and the format served. Fixed once created.',
    typeHintFixed: 'The type was set at creation: a body does not carry from one type to another.',
    name: 'Name',
    nameHint: 'This is how a delivery rule picks the template.',
    nameDefaultLocked: 'The name Default is reserved: it is how the template is found and restored.',
    nameTaken: 'A template of this type already carries that name.',
    body: 'Body',
    bodyHint:
      'A whole client config. The panel fills the slots of its type with servers; everything else stays as written.',
    // Default: never deleted or renamed, but it can be restored.
    restoreAction: 'Restore Default',
    restoring: 'Restoring...',
    restored: 'Default restored',
    restoreFailed: 'The restore did not happen',
    restoreTitle: 'Restore the built-in Default?',
    restoreBody:
      'The body is replaced with the built-in one. Your edits to it are gone, and there is nowhere to get them back from: the panel keeps no copy.',
    defaultProtected: 'Default cannot be deleted: everyone without a template of their own runs on it.',
    deleteTitle: 'Delete {{name}}?',
    deleteBody:
      'Delivery rules that named this template start serving the Default of their type. The template itself cannot be brought back.',
    deleted: 'Template deleted',
    // The dry run: the template is built over three synthetic nodes and the
    // core says whether such a config would load at all.
    dryRun: 'Dry run',
    dryRunning: 'Building...',
    dryRunFailed: 'The dry run did not happen',
    dryRunUnavailable: 'The dry run arrives with phase 11, together with the template store.',
    checkOk: 'the core accepted the config',
    checkFailed: 'the core refused the config',
    warnings: 'The panel noticed',
    warningsNote:
      'This is not a refusal from the core: such a config loads. But if a slot stayed empty, everyone caught by this rule gets an empty subscription.',
    rendered: 'What the client gets',
    renderedHint: 'Built over three synthetic nodes. Your servers take their place.',
    confirmTitle: 'Save with these notes?',
    confirmBody: 'The core accepts the config. The notes above stay, and they are visible only here.',
    invalid: 'The server refused the template:',
    invalidAtLine: 'Line {{line}}:',
    invalidNoMessage: 'no explanation given',
    // The first thing missing, not a list of complaints.
    blocker: {
      name: 'name it',
      body: 'the body is empty',
      clean: 'nothing changed',
    },
    emptyTitle: 'No templates yet',
    emptyBody:
      'Without a template the subscription serves the default config. Create one to decide everything else for the client: groups, rules, profile name. A template from elsewhere can be imported as a file, and its keys are rewritten to ours.',
  },
} as const;
