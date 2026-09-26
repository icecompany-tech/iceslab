export const cascades = {
  // The build-a-cascade page. Separate from `cascades` (the list) because the
  // wording here is instructional: it is read once per cascade, while building.
  cascadeCreate: {
    crumbSection: 'Cascades',
    crumbNew: 'New',
    title: 'New cascade',
    subtitle:
      'One or more entries, one or more directions on the way out. The client lands on any entry and picks the direction itself.',
    subtitleBalancer:
      'One entry in front of several exits. Clients connect to the entry and land on one exit, which egresses direct.',
    draft: 'Draft · not saved',
    create: 'Create cascade',
    creating: 'Creating...',
    basics: 'Basics',
    name: 'Name',
    // Deliberately not "shown in the subscription": the subscription labels
    // every server after the NODE it exits through, never after the cascade.
    nameHint: 'Names the cascade in the panel. Subscribers see the node names.',
    state: 'State',
    stateOn: 'Enabled',
    stateOff: 'Disabled',
    stateHint: 'Off keeps the config but stops serving it.',
    mode: 'Mode',
    modeChain: 'Chain (sequential)',
    modeChainHint: 'Entry, then transits in order, then one exit. Every hop forwards to the next.',
    modeBalancer: 'Balancer (auto exit)',
    modeBalancerHint: 'One entry, several parallel exits. The client picks an exit by picking a server.',
    hideHops: 'Hide exit nodes from subscription',
    hideHopsHint:
      'On: exits are reachable only through the cascade entry. Off: they also appear as direct picks in the subscription.',
    hops: 'Hops (entry, transit, exit)',
    hopsBalancer: 'Hops (entry, exits)',
    hopsLeft: '{{n}} left',
    node: 'Node',
    nodePlaceholder: 'pick a node',
    entryProtocol: 'Entry protocol',
    linkProtocol: 'Link to next',
    linkProtocolBalancer: 'Link to exits',
    notApplicable: 'not applicable',
    egressDirect: 'egress direct',
    addHop: 'Add hop',
    addExit: 'Add exit',
    moveUp: 'Move up',
    moveDown: 'Move down',
    inCascade: 'in {{name}}',
    alreadyInThis: 'already in this cascade',
    chainTitle: 'The chain',
    chainForwarded: 'forwarded over {{protocol}}',
    chainBalanced: 'balanced over {{protocol}}',
    chainPendingEntry: 'entry node not picked yet',
    chainPendingTransit: 'transit node not picked yet',
    chainPendingExit: 'exit node not picked yet',
    needName: 'Give the cascade a name to enable Create.',
    needExit: 'Pick the exit node to enable Create.',
    needExits: 'Pick a node for every exit to enable Create.',
    needDistinct: 'A node cannot appear twice in one cascade.',
    ready: 'Ready. On create the config goes out to every hop.',
    readyDisabled: 'Ready. Created disabled, so nothing is pushed until you enable it.',
    entryCoreOld:
      '{{name}} runs xray {{version}}, picking a direction needs {{min}}. A client landing on it loses the choice silently.',
    rules: 'Rules of the road',
    rule1: 'A RU entry on REALITY survives whitelist shutdowns, an EU exit gives clean internet.',
    rule2: 'Two positions minimum, {{max}} maximum. A node can belong to one cascade at a time.',
    rule3: 'Every entry node needs xray {{min}} or newer, otherwise it rejects per-direction auth.',
    rule4: 'On save the panel pushes the config to every node and waits for each to apply it.',
    rule5: 'Entries multiplied by directions is the link count, {{max}} at most.',
    // The shape is not stored anywhere: it follows from how many positions and
    // directions the form ends up holding. The tiles only seed it.
    startFrom: 'Start from',
    startFromHint: 'Only a starting point. Add positions or directions later and the shape follows.',
    shapeOne: 'One way out',
    shapeOneHint: 'Entry and one direction. Add a transit position to make the path longer.',
    shapeMany: 'Several ways out',
    shapeManyHint: 'Entry and two directions. The client picks a direction by picking a server.',
    positions: 'Positions (entry, exit)',
    positionsTransit: 'Positions (entry, transit, exit)',
    positionsHint: 'A position is one step of the path. Several nodes on a position run in parallel, not in turn.',
    positionsLeft: '{{n}} left',
    addPosition: 'Add position',
    poolEntry: 'Nodes · any of them accepts the client',
    poolTransit: 'Nodes · any of them relays the traffic onward',
    addNode: '+ node',
    poolNote: '{{n}} nodes in this pool',
    directionsCaption: 'Directions · the tag belongs to the direction, not the node',
    tag: 'Tag',
    direction: 'Direction',
    directionNodes: 'Nodes under it',
    countryPlaceholder: 'pick a country',
    addDirection: '+ direction',
    tagOnce: 'the next tag is issued once and never reused',
    directionsFoot:
      'Nodes under a direction change as often as you like, the tag is issued once and never reused. A direction carries one tag per granted policy, plain first.',
    directionNoNodes: 'no nodes yet',
    chainPendingDirection: 'no direction picked yet',
    chainPendingDirectionN: 'direction {{n}} not picked yet',
    // The leg row between positions. The port is read-only: the panel assigns
    // it from the step number, and it is shown because it is what gets opened
    // in the firewall.
    // An entry the chain does not carry. The option stays in the list: it is
    // planned, and hiding it would lie about the plan the way silence lies
    // about today. No phase numbers: they changed twice in two days and each
    // time made the line untrue. The supported list comes from
    // CHAIN_ENTRY_PROTOCOLS, the same one the server refusal reads.
    entryNotCarried: 'An entry over {{protocol}} does not reach the chain: a cascade entry serves only {{supported}}.',
    entryNoCore: 'This node cannot be an entry: it has no core for {{supported}}.',
    entryNoCoreOr: ' or ',
    // The edge of phase 6, and it belongs where the operator picks the entry:
    // hearing it from a user who "cannot choose a country" is worse.
    entryHy2Auto:
      'A hysteria entry leaves through Auto or by policy rules; picking the exit per user is available only to an xray entry.',
    // The server's refusal: the entry nodes cannot run the chain, sing-box is
    // missing. A server FACT from the node's report, so the button is not
    // disabled ahead of it.
    entryCannotChain: '{{name}} reported {{engines}}, sing-box is not on it.',
    entryPolicyLabel: 'entry policy',
    entryPolicyNone: 'none',
    entryPolicyHint: 'for every user of this entry',
    entryPolicyXray: 'xray users pick their policy themselves.',
    entryPolicyGone: 'The chosen policy is gone: it was deleted while the form was open. Pick another or "none".',
    // A fact of the one-entry-per-cascade model, not a fault: a quiet line.
    // It belongs next to the entry picker, not in a user's call about a foreign IP.
    entryBystanders:
      'The {{protocols}} profiles on {{name}} are outside the cascade; their users leave straight from {{country}}.',
    entryCountryUnknown: "this node's country",
    legPort: 'port {{port}}',
    legUnknown: 'no link cell picked',
    legToDirections: 'the leg to the exit is set on the direction',
    // The direction's own leg. "Not picked" and "the server said nothing" are
    // different things, and they get different words.
    legFromEntry: "the entry's cell",
    legPortServer: 'the server assigns the port',
    legNotReported: 'the server did not report this leg',
    // Nothing to set on hy2: the salt is minted by the panel, and its rate
    // control is a bandwidth pair nobody has decided how to ask for yet.
    legObfsMinted: 'The Salamander salt is minted by the panel, like every other link credential.',
    legCongestion: 'congestion control',
    underlayLabel: 'transport under the leg',
    underlayDirect: 'direct',
    underlayAwg: 'inside AmneziaWG',
    // The direction's third setting: no key, the leg rides as the last position
    // (E25: a click on the direction used to write an explicit direct).
    underlayInheritOption: 'as the position: {{value}}',
    underlayOneLeg: 'the cascade has one leg, this is the leg to the exit',
    underlayAtDirection: 'set on the direction below: the cascade has one leg, and this is it',
    underlayAwgHint: 'Between the nodes only AWG packets are on the wire, the leg runs inside the tunnel; the panel picks port 27000+n/udp itself.',
    underlayMissing: '{{name}} has no AmneziaWG: the tunnel under the leg cannot be raised there.',
    underlaySilent: '{{names}}: the node has not reported its cores, AmneziaWG cannot be checked. It can be chosen, the server checks the fact.',
    underlayRefused: 'The server refused: AmneziaWG is not installed on {{names}}. Install it there or keep the leg direct.',
    legCongestionDefault: 'default {{value}}',
    legNodeGap: '{{name}} does not carry {{cell}}: it reported {{engines}}.',
    // The transport belongs in the sentence: 24001/udp and 24001/tcp are
    // different sockets, and one being taken says nothing about the other.
    legPortTaken: '{{port}}/{{transport}} on {{name}} is taken by profile {{profile}}.',
    legPortTakenUnnamed: '{{port}}/{{transport}} on {{name}} is already taken.',
    legNodeNoEngines: 'an empty core list',
    needEntry: 'Pick at least one entry node to enable Create.',
    needDirection: 'Give every direction a country to enable Create.',
    tooManyLinks: '{{n}} links, the ceiling is {{max}}. Drop an entry or a direction.',
  },
  // The edit page. Shares most of its wording with `cascadeCreate`; what lives
  // here is what only a LIVE cascade has: a push to report, subscribers already
  // holding its config, and a delete.
  cascadeEdit: {
    gone: 'This cascade no longer exists.',
    // The node was deleted after the cascade had been saved. An empty picker
    // in its place read as "the operator did not choose one", which is a lie
    // about the cause.
    nodeGone: 'node deleted',
    // The timestamp in the header is the SAVE time, and it has to say so: a
    // bare "36 d ago" under a heading about pushes read as the push time.
    savedAgo: 'saved {{when}}',
    // An entry change that takes the cascade off the entry nodes' profiles
    // (phase 6). A question, not a refusal: the operator sees who is affected
    // before it happens. The SERVER names from and to: guessing them from the
    // form would caption the wrong change if the form moved again meanwhile.
    entryDropTitle: 'Change the cascade entry from {{from}} to {{to}}?',
    entryDropTitleBare: 'Change the cascade entry?',
    entryDropBody: 'These profiles leave the cascade and go direct, out of the entry country:',
    entryDropRow: '{{profile}} on {{node}}',
    entryDropConfirm: 'Change anyway',
    // The second question of the same chain: nodes leave the entry, the
    // protocol stays.
    entryNodesTitle: 'Take these nodes out of the entry?',
    entryNodesRow: '{{node}}: {{profiles}}',
    entryNodesConfirm: 'Take them out anyway',
    entryQuestionRepeated:
      'The server asked again a question you already agreed to. The save stopped; reload the page and check the cascade.',
    attemptApplied: 'Last attempt {{when}} · all took it',
    attemptRefused: 'Last attempt {{when}} · {{refused}} of {{total}} refused',
    save: 'Save and push',
    saving: 'Saving...',
    unsaved: 'Unsaved changes',
    factPositions: '{{n}} positions',
    factEntries: '{{n}} entries',
    factDirections: '{{n}} directions',
    factToday: '{{size}} today',
    noTraffic: 'no traffic today',
    nameHint: 'Renaming changes the label of the Auto entry in every subscription.',
    subLabel: 'Subscription label',
    hideHopsHintNamed:
      'On: {{names}} are reachable only through this cascade. Off: they also appear as direct picks.',
    chainBalancedLong: 'balanced over {{protocol}}, exit picked per connection',
    deleteTitle: 'Delete {{name}}?',
    deleteBody:
      'The chaining config is removed from all {{count}} nodes on the next push. The nodes themselves stay, along with their own hosts.',
    autoProfile: 'Auto line in the subscription',
    autoProfileHint:
      'A separate entry that names no country: the entry picks the lowest-latency direction itself and re-picks it on every new connection. A user whose squad restricts exits does not get it, because Auto can leave through any of them and would walk past that restriction.',
    autoProfileNeedsTwo:
      'Needs at least two directions with nodes. With one, Auto leads exactly where the row above it does.',
    subTitle: 'What subscribers see',
    subDisabled: 'Nothing. A disabled cascade is not served to anybody.',
    subVia: '{{name}} → {{where}}',
    subAuto: '⚡ {{name}} → Auto',
    subTag: 'tag {{tag}} · plain',
    subDirect: 'also a direct pick',
    subHintMany:
      'One entry per direction, and a squad can narrow the list to the directions it grants. A direction with no live node under it never reaches a subscription. Every entry of a pool offers the same set, so those lines carry their transport to stay distinct.',
    subHintOne:
      'One direction, so one entry. A squad granted no policy sees just this one.',
    legacyProtocol:
      '{{node}} stores "{{value}}", which this panel can no longer write. Pick a protocol before saving.',
    pushTitle: 'Last push',
    tunnelsTitle: 'AmneziaWG tunnels',
    tunnelPort: 'port {{port}}/udp',
    tunnelRotate: 'Rotate keys',
    tunnelsRotateAll: 'Rotate all',
    tunnelRotateTitle: 'Rotate the keys of tunnel {{from}} → {{to}}?',
    tunnelsRotateTitle: 'Rotate the keys of every tunnel of the cascade ({{count}})?',
    tunnelRotateBody: 'The keys of both ends are reissued, the leg reconnects. Interface, subnet and port stay.',
    tunnelsRotateBody: 'The keys of both ends of every tunnel are reissued, the legs reconnect one by one. Interfaces, subnets and ports stay.',
    tunnelRotateConfirm: 'Rotate',
    tunnelRotated: 'Tunnel keys reissued, the push to both nodes is under way',
    tunnelsRotated: 'Keys of every tunnel reissued, the push is under way',
    tunnelRotateFailed: 'Rotation failed',
    tunnelGone: 'The cascade no longer has that tunnel: the list is refreshed.',
    tunnelPortOpen: 'The leg port on {{node}} stays open to the internet: a leg from another node arrives directly.',
    tunnelsHint: 'A cascade save creates a tunnel when a leg rides inside AmneziaWG; a save never changes its keys, only a rotation does.',
    pushPending: 'Not applied yet: {{names}}',
    broken: 'Broken: {{broken}}',
    brokenShort: 'The cascade is not working, reason above',
    pushNote: 'Saving pushes the config to all {{n}} nodes again and briefly restarts the entry core.',
    hopApplied: 'applied',
    hopWaiting: 'waiting',
    hopOffline: 'offline',
    justNow: 'just now',
    minAgo: '{{n}} min ago',
    hourAgo: '{{n}} h ago',
    dayAgo: '{{n}} d ago',
  },
} as const;
