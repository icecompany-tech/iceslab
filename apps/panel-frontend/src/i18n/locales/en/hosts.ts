export const hosts = {

  // A host on a node that is not the entry of a cascade. Shared namespace: the
  // host card, the host page and the deploy window all draw it, and three
  // copies would drift. The cascade name in the line links to it.
  hostHidden: {
    before: 'Node {{node}} is not the entry of cascade ',
    after: ': no subscription will hand this host out while the cascade is on.',
  },

  // The port check on a node. Lives in the shared namespace rather than in
  // hostEdit: both forms show the line, the binding and the inbound, and a
  // second copy of the text would drift from the first on the first edit.
  portCheck: {
    checking: 'Checking the port on the node…',
    free: '{{port}}/{{transport}} is free',
    partial:
      'No collisions among bindings and cascades; the service ports of this node\'s cores are unknown, the node has not reported.',
    busyProfile:
      'Profile "{{name}}" already listens on {{port}}/{{transport}}. A second {{transport}} protocol on the same port needs a demultiplexer, which the panel cannot do yet. Pick another port.',
    busyCascade:
      '{{port}}/{{transport}} is taken by cascade "{{name}}": that is the link port between hops, opened by the chain itself. Pick another port.',
    busyCore:
      '{{port}}/{{transport}} is taken on this node by {{owner}} (loopback only). It does not face outward, but it listens. Pick another port.',
    // Not an objection, a heads-up: the number already appears in the list, but
    // the socket is a different one and the two sit side by side routinely.
    freeOtherTransport: '"{{holder}}" listens on {{port}}/{{otherTransport}}, which is a different socket.',
    // The refusal on save when no conflict list came with it: the code says
    // what happened, and that is enough not to stay silent.
    refused: {
      PORT_TAKEN_PROFILE: 'Not saved: another profile already listens on that port.',
      PORT_TAKEN_CASCADE: 'Not saved: that port is held by a cascade.',
      PORT_TAKEN_CORE_SERVICE: 'Not saved: that port is held by a core service listener.',
    },
    // The dictionary of service listeners. A key that is not here is NOT
    // invented: it is shown as it came, being the only handle for finding that
    // service on the machine.
    owner: {
      'hysteria-auth': 'the Hysteria 2 auth endpoint',
      'hysteria-stats': 'the Hysteria 2 stats endpoint',
      // Interface names are exact: xray speaks gRPC, sing-box historically
      // exposes the v2ray API. A plain "API" reads easier and searches worse
      // when the operator goes looking in the config on the machine.
      'xray-api': 'the xray gRPC API',
      'shadowsocks-api': 'the gRPC API of the second xray behind Shadowsocks',
      'singbox-api': 'the sing-box v2ray API',
      'mtproto-stats': 'the mtg stats endpoint',
      // Phase 4, the chain as its own process. Added ahead of time: it draws
      // nothing until an agent reports it, and an unknown key would reach the
      // operator as bare "chain-socks" instead of words.
      'chain-socks': 'the chain socks port',
    },
  },

  // The Hosts page and its editor. The older `hosts` namespace next to this
  // one belonged to the per-binding editor, which is gone: nothing reads it
  // any more, so it went with the component.
  hostsPage: {
    searchPlaceholder: 'Search by name, port or profile…',
    deleteTitle: 'Delete {{name}}?',
    deleteBody: 'The line disappears from every subscription on the next fetch.',
    deleteLast:
      'This is the last host on {{node}}, so the inbound comes off that node and the port is freed. The node config is rewritten and xray restarts there, which drops live sessions on every inbound of that machine, not only this one.',
    deleted: 'Host deleted',
    empty: 'No hosts yet. A host is one entry in the user\'s client: a name, a port and the nodes behind it.',
    unbound: 'binding missing',
    create: 'Create host',
    allCountries: 'All countries',
    bar: {
      hosts: 'HOSTS',
      live: 'LIVE',
      noNodes: 'NO NODES',
      degraded: 'DEGRADED',
    },
    card: {
      profile: 'Profile',
      nodes: 'Nodes',
      noNodesAttached: 'no nodes attached, serves nobody',
      squads_one: '{{count}} squad',
      squads_other: '{{count}} squads',
      reach_one: '{{count}} user reaches it',
      reach_other: '{{count}} users reach it',
      live: 'LIVE',
      noNodes: 'NO NODES',
      // Still handing out URLs, but through a node that is not answering.
      degraded_one: 'SERVING, {{count}} NODE DOWN',
      degraded_other: 'SERVING, {{count}} NODES DOWN',
      off: 'OFF',
    },
  },

  hostEdit: {
    freshTitle: 'Subscription version',
    freshLead: 'Editing a host breaks clients that have not refetched the subscription yet',
    freshCurrentLabel: 'Took the new link',
    freshOfTotal: 'of {{total}} · {{pct}}%',
    freshStale_one: '{{count}} person still on the old one',
    freshStale_other: '{{count}} people still on the old one',
    freshChanged:
      'The link changed {{at}}. These people can no longer connect and will find out on their own.',
    freshNever_one: '{{count}} of them never took the link at all',
    freshNever_other: '{{count}} of them never took the link at all',
    freshRetention:
      'Request history is kept for {{days}} days. Anyone quieter than that is indistinguishable from someone who never came.',
    newTitle: 'New host',
    newCrumb: 'NEW',
    newSubtitle: 'NAME IT, PICK A PROFILE, ATTACH NODES',
    editSubtitle: 'CHANGES REACH CLIENTS ON THEIR NEXT SUBSCRIPTION FETCH',
    notFound: 'This host no longer exists.',
    backToList: 'Back to hosts',
    create: 'Create host',
    created: 'Host created',
    saved: 'Host saved',
    pickNodeFirst: 'Pick a node before creating the host.',
    basics: 'Basics',
    name: 'Name',
    nameHint: 'What people see in the server list.',
    country: 'Country',
    countryHint: 'Flag shown next to the name.',
    port: 'Port',
    portHint: 'Every node of this host listens here.',
    state: 'State',
    enabled: 'Enabled',
    disabled: 'Off',
    stateHint: 'Off hides it from every subscription.',
    profile: 'Profile',
    pickProfile: 'Pick a profile',
    openProfile: 'Open profile',
    // Not «only matching nodes can take it»: about a node that has never
    // reported the panel knows nothing, and promising on its behalf is a
    // guess. The check by fact happens on save.
    profileHint:
      'Nodes that reported their cores are marked below. Changing the profile re-checks the list.',
    profileLockedHint: 'The profile is fixed once a host exists: it is what the client already speaks.',
    addressHint: 'One link, possibly several nodes. They need one name between them.',
    aRecordTitle: 'Point an A record at the node IP',
    aRecordEmpty:
      'With a single node this can stay empty: the address comes from it. Give it a name of its own when a CDN sits in front, or once there is more than one node.',
    advanced: 'Advanced: SNI, path, fingerprint, formats',
    advancedHint: 'Only needed when a CDN sits in front',
    addressFromProfile: 'Empty falls back to {{name}} from the profile, not to the node address.',
    advancedFormatsOnly: 'Advanced: subscription formats',
    advancedFormatsHint: 'This profile carries no client-side TLS or transport to override',
    nSet_one: '{{count}} SET',
    nSet_other: '{{count}} SET',
    groupWire: 'HOW IT LOOKS ON THE WIRE',
    hostHeader: 'Host header',
    followsSni: 'follows SNI',
    fingerprint: 'Fingerprint',
    fromProfile: 'from the profile',
    alpn: 'ALPN',
    securityLayer: 'Security layer',
    formats: 'SUBSCRIPTION FORMATS',
    // Used to say "computed from profile + overrides", untrue from day one:
    // the list is the host's manual opt-outs, nothing is computed. Whether a
    // format carries the protocol comes from the server later
    // (GET /api/profiles/:id/formats).
    formatsCaption:
      'Everything is on unless the operator turned it off. Whether a client handles this protocol, the page does not know yet.',
    formatsCount: 'Carried by {{carried}} of {{total}}, turned off {{off}}',
    formatWhy: {
      'client-lacks-protocol': 'The client does not speak this protocol',
      'no-uri-standard': 'The protocol has no share link',
      'not-yet': 'The panel does not build it yet, the client can',
    },
    optional: 'OPTIONAL',
    needName: 'Name it first',
    needProfile: 'Pick a profile',
    needPort: 'Set a port',
    needNode: 'Pick a node',
    portConflictFallback: 'That port is already taken on this node.',
    goneWhileEditing:
      'The profile or the node is gone. The lists were refreshed, pick again before saving.',
    sniMismatchToast: 'This SNI is not one the node serves.',
    sniExpected: 'The node serves: {{names}}. Use one of these or clear the field.',
    address: 'Own address',
    sni: 'SNI',
    path: 'Path',
    nodesBehind: 'Nodes behind this host',
    nodesSelected: '{{selected}} of {{total}} selected',
    nodeSearch: 'Search nodes by name, address or country…',
    onlyAttachable: 'Only attachable',
    portFree: '{{port}} free',
    portUnset: 'set a port to check',
    portTaken: '{{port}} taken by {{host}}',
    // From the core list the node reported itself, not from its label nor from
    // the version string of its primary core: a second core lives beside it.
    wrongCore: 'reported other cores',
    whatPeopleSee: 'What people see',
    unnamed: 'Unnamed host',
    previewHintNew:
      'This is the line people will get once you save. Nothing reaches them until a squad grants this host.',
    previewHint: 'This is the line people already have in their client.',
  },
} as const;
