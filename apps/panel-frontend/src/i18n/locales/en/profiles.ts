export const profiles = {

  profiles: {
    emptyTitle: 'No profiles yet',
    emptyBody: 'A profile is one protocol with its settings: what a node listens with and what the client dials. Start from a recipe, it fills the risky fields for you.',
    emptyFromRecipe: 'Start from a recipe',
    emptyBlank: 'Blank profile',

    telegramPreview: {
      banner: 'You can fill it in, you cannot save it yet',
      bannerHint:
        'The fields are live, but the values stay on this page: the backend does not accept this way in yet, nothing is sent and the server checks nothing. MTProto, SOCKS5 and HTTP create a Telegram profile right now.',
      saveBlocked: 'The backend does not know this way in yet; fill the fields to see the form',
      web: {
        title: 'TELEGRAM WEB CONFIG',
        hostLabel: 'Web proxy host *',
        hostPlaceholder: 'proxy.example.com',
        hostNote: 'A domain with a real certificate, no https:// and no port. HTTPS and 443 are baked into the view.',
        hostBad: 'The domain name only: no https://, port or path. The path has its own field below.',
        keyLabel: 'Secret *',
        keyPlaceholder: '32 hex characters',
        keyGenerate: 'Generate',
        keyBad: 'Exactly 32 hex characters are needed.',
        keyNote:
          'The ordinary MTProxy client secret, 16 bytes. The button makes it here, in the browser. All a person enters on their side is the host and the secret.',
        pathLabel: 'Base path',
        pathPlaceholder: 'optional',
        pathNote: 'When the proxy lives under a path and a site sits at the root. With a path the secret in the link turns into base64url: Telegram requires it.',
        pathBad: 'Only letters, digits and . _ ~ - in the path, segments separated by /.',
        carrierLabel: 'Carrier',
        carriers: {
          https: 'One serialized POST and one long poll for every stream.',
          'https-lanes': 'Its own POST and long poll for each stream.',
          websocket: 'One WebSocket carrying every stream.',
          'websocket-lanes': 'Its own WebSocket for each stream.',
        },
        linkLabel: 'Client link',
        linkWait: 'Appears once there is a host and a secret.',
        linkBad: 'No link: Telegram would not take one of the fields above.',
        linkNote: 'Built in the reference relay format. For now it is a preview: the subscription page does not hand it out.',
        warn: 'The client warns the user: the provider of such a proxy runs a web page in the background and may show a sponsored channel. Traffic stays private, but trust is required.',
        stackTitle: 'What the panel would run on the node',
        stackHint: 'Three layers instead of one daemon. This is not a protocol, it is a stack.',
        caddyPort: '443, public',
        relayPort: '8080 and 8081, local',
        mtproxyPort: '2398, local',
        portWarn:
          'Port 443 must be free on that node. Ours is usually taken by REALITY or hysteria.',
      },
    },

    generate: {
      hosts_one: 'host',
      hosts_other: 'hosts',
      nodes_one: 'node rebuilds',
      nodes_other: 'nodes rebuild',
      configs: 'configs go stale',
      configsPending: 'The panel cannot count these yet: it would have to run the subscription pipeline for every member of every squad that reaches this profile.',
      body: 'The key belongs to the profile, so every node of every host on it serves the same one. Replacing it takes effect everywhere at once and the old key is gone.',
      confirmTitle: 'Replace the key pair?',
      confirmBody: 'This profile is served by {{hosts}} hosts on {{nodes}} nodes. All of them get the new key and every config already handed out stops working.',
      confirmAction: 'Replace',
    },    bar: {
      profiles: 'PROFILES',
      inUse: 'IN USE',
      unused: 'UNUSED',
    },
    allProtocols: 'All protocols',
    configButton: '{{core}} config',    engine: {
      native: 'Native daemon',
      xray: 'Xray core',
      singbox: 'Sing-box',
      telegram: 'Telegram',
      hint: 'The tab decides which binary runs on the node',
      tabHint: {
        native: 'Each protocol here runs its own process',
        xray: 'The tab decides which binary runs on the node',
        singbox: 'One binary covers all six protocols',
        telegram: 'Exactly the four the Telegram client itself offers',
      },
      coreVersion: 'Core version',
      pin: 'pin',
      noPin: 'no pin',
      noPinWhy: 'No pin: {{reason}}',
      component: {
        xray: 'xray',
        singbox: 'sing-box',
        hysteria: 'hysteria',
        'amneziawg-module': 'AWG module',
        'amneziawg-tools': 'AWG tools',
        mtg: 'mtg',
        mita: 'mita',
        'caddy-naive': 'caddy-naive',
      },
      fleet: '{{onPin}} of {{total}} nodes on the pin, {{other}} otherwise, {{silent}} not reported',
      fleetUnpinned: '{{reported}} of {{total}} nodes reported a version, {{silent}} not reported',
      fleetNone: 'No node has reported this core',
      otherTitle: 'Otherwise:',
      reportedTitle: 'Reported:',
      silentTitle: 'Not reported:',
      coreVersionHint:
        'The core version belongs to the node: one process serves every profile of this core. It is changed on the node page, in the Cores section.',
      toNodes: 'To nodes',
      webNoCore: 'The panel does not install or pin the WEB core (tproxy-server, MTProxy, Caddy) yet; it comes with the WEB phase.',
    },
    title: 'Profiles',
    subtitle: 'Inbound templates - one profile can be deployed to multiple nodes',
    create: 'Create',
    refresh: 'Refresh',
    searchPlaceholder: 'Search by name or description…',
    emptyFiltered: 'Nothing matches the filter.',
    deployToNodes: 'Deploy to nodes',
    // Both tooltips promised a click while the chip was not clickable: a dead
    // promise, left over from when deploying lived only in the hint shown after
    // creating a profile. Both now open the host screen with this profile
    // already chosen.
    bindingsTooltipNone: 'Running nowhere. Open a host and pick a node.',
    bindingsTooltipDeployed: 'How many nodes serve it. Open a host and add another.',
    deployHere: 'Deploy on a node',
    usersTooltip: 'Users with access via squads: {{count}}',
    deleteTitle: 'Delete profile "{{name}}"?',
    deleteWithBindings: 'Profile is deployed to {{count}} nodes. Deleting will remove it from all nodes (cascade) and invalidate this protocol\'s subscriptions for affected users.',
    deleteSafe: 'Profile is not bound to any node - safe to delete.',
    notify: {
      created: 'Profile created',
      createdOpenDeploy: 'Profile created. Pick nodes + port to deploy →',
      updated: 'Profile updated',
      deleted: 'Profile deleted',
    },
    form: {
      titleCreate: 'Create profile',
      titleEdit: 'Profile: {{name}}',
      name: 'Name',
      protocol: 'Protocol',
      protocolEdit: 'Cannot change after creation',
      description: 'Description',
      descriptionPlaceholder: 'What this template is for',
      submitCreate: 'Create profile',
      submitEdit: 'Save',
      plain: {
        onXray: 'on the xray core: the same process as the node\'s other xray profiles, no new binary',
        fixed: 'No TLS, REALITY or transport: Telegram clients talk to such a proxy directly over TCP, there is nothing to pick here.',
        auth: 'Always the user\'s own username and password: everyone has their own, the name and their UUID, and they are not typed here. There is no way in without a password: an open proxy on a public node would carry strangers\' traffic.',
        portSocks: 'The port is set when deploying to a node, 1080 by default, and goes through the same port check as everything else.',
        portHttp: 'The port is set when deploying to a node, 3128 by default, and goes through the same port check as everything else. 8080 is not offered: the xray API lives there.',
        udp: 'UDP is off: Telegram does not use it over SOCKS5.',
        httpClients: 'Telegram Desktop only, and Telegram has no link to add it: a person types the address, port, username and password by hand. A CONNECT tunnel, TCP only.',
        digest: 'Basic scheme; Digest is supported neither by the core nor by the Telegram client. Basic is a username and password in base64, not encryption.',
        noObfs: 'No obfuscation: for networks where a proxy is allowed, not for getting past DPI. Neither SOCKS5 nor HTTP encrypts anything by itself.',
      },
      cfg: {
        salamanderObfsLabel: 'Salamander obfs password',
        salamanderObfsDesc: 'Optional. Empty = no obfuscation.',
        masqueradeUrlLabel: 'Masquerade URL',
        brutalUpLabel: 'Brutal CC, ↑ Mbps',
        brutalDownLabel: 'Brutal CC, ↓ Mbps',
        realityDestDesc: 'host:port, fronting decoy',
        stepProtocol: '1 · Protocol',
        stepTransport: '2 · Transport',
        stepSecurity: '3 · Security',
        keypairLabel: 'Keypair',
        keypairPlaceholder: 'not generated',
        serverNamesLabel: 'Server names',
        shortIdsLabel: 'Short IDs',
        basicsTitle: 'Basics',
        configTitle: '{{protocol}} config',
        advHint: 'optional',
        awgMimicryTitle: 'Advanced: I1-I5 mimicry packets (optional)',
        awgMimicryDesc:
          'AmneziaWG v2.0 feature: masks the handshake as another protocol (QUIC / DNS / STUN). Needed ONLY when the standard TSPU/Mobile preset does not get through DPI. Empty fields mean off, which is safe. Values are hex, up to 256 characters each, and MUST match the client.',
        realityModeLabel: 'REALITY mode',
        realityModeDesc: 'How REALITY borrows a TLS identity',
        realityModeStealOthers: 'steal-from-others (external decoy)',
        realityModeSelfSteal: 'self-steal (local fallback, RU-2026)',
        singboxXrayOnly: 'On sing-box only REALITY (steal-others) over raw; TLS, self-steal and other transports are on the xray core.',
        realityModeSelfStealHint:
          'Self-steal: the node runs a local TLS fallback and REALITY dest points at it. Set the domain below to one that resolves to THIS node IP, so SNI and IP match (survives RU whitelist-shutdown). dest is ignored.',
        realityFallbackUpstreamLabel: 'Realistic fallback (G1, optional)',
        realityFallbackUpstreamDesc:
          'http(s) URL of a real site the local fallback reverse-proxies probe requests to, so a deep prober sees genuine content instead of a stub page. Empty = static landing.',
        realitySelfStealDomainLabel: 'Your domain (must point to node IP)',
        realitySelfStealDomainDesc:
          'A-record this domain to THIS node IP. The node serves a local TLS cert for it, REALITY uses it as serverName: SNI and IP stay consistent.',
        realityServerNamesDesc: 'comma-separated',
        realityShortIdsDesc: 'hex, comma-separated',
        realityFingerprintDesc: 'client TLS fingerprint',
        realityPrivateKeyDesc: "curve25519 base64. Click Generate or paste from `xray x25519`.",
        realityPublicKeyDesc: 'auto-derived from private',
        realitySubprotocolDesc: 'VLESS is Vision-ready. Trojan, password auth.',
        realitySubprotocolVless: 'VLESS (canonical)',
        realitySubprotocolTrojan: 'Trojan (no Vision)',
        realityFlowDesc: 'Vision only works with raw',
        realityFlowNone: '(none), no flow',
        realityNetworkDesc: 'REALITY supports raw / xhttp / grpc',
        realityNetworkRaw: 'raw (TCP), Vision-compatible',
        xhttpPathDesc: 'HTTP path for the xhttp transport',
        hostHeaderDesc: 'optional, defaults to SNI',
        grpcServiceNameDesc: 'gRPC service name',
        // B3 advanced (xray) tabs
        advTitle: 'Advanced: REALITY, TLS, transport tuning',
        advRealityTab: 'REALITY',
        advTlsTab: 'TLS',
        advTransportTab: 'Transport',
        advRealityInactive: 'These apply only when security is REALITY.',
        advTlsInactive: 'This applies only when security is TLS (own cert).',
        advTransportInactive: 'These apply only when the transport is xhttp or gRPC.',
        realityXverLabel: 'REALITY xver',
        realityXverDesc: 'HTTP version sent to the decoy: 0 = auto, 1 = HTTP/1.1, 2 = HTTP/2',
        realityMaxTimeDiffLabel: 'Max time diff (ms)',
        realityMaxTimeDiffDesc: 'Allowed clock skew, ms. 0 = no limit',
        // G probe resistance: throttle the unverified fallback path
        realityFallbackRateGroup: 'Fallback rate-limit (probe resistance)',
        realityLimitFallbackUploadLabel: 'Upload limit (bytes/sec)',
        realityLimitFallbackUploadDesc: 'Throttle unverified fallback uploads so a prober sees a slow site. 0 = off',
        realityLimitFallbackDownloadLabel: 'Download limit (bytes/sec)',
        realityLimitFallbackDownloadDesc: 'Throttle unverified fallback downloads so a prober sees a slow site. 0 = off',
        tlsRejectUnknownSniLabel: 'Reject unknown SNI',
        tlsRejectUnknownSniDesc: 'Drop the handshake if the client SNI is not on the certificate',
        xhttpModeLabel: 'xhttp mode',
        xhttpModeDesc: 'Packet framing: auto, packet-up, stream-up or stream-one',
        xhttpPaddingBytesLabel: 'xhttp padding bytes',
        xhttpPaddingBytesDesc: 'Random padding range, e.g. 100-1000. Empty = off',
        grpcMultiModeLabel: 'gRPC multiMode',
        grpcMultiModeDesc: 'Enable gRPC multi-mode (parallel streams). Client must match',
        generate: 'Generate',
        regenerate: 'Regenerate',
        awgSubnetLabel: 'Subnet (CIDR)',
        awgSubnetHint: 'Avoid 10.0.0.0/24, it collides with some hosters',
        awgSubnetLockedHint: 'Changing it after keys are handed out strands every peer already on this subnet',
        awgServerPrivLabel: 'Server private key',
        awgServerPubLabel: 'Server public key',
        awgServerPubPlaceholder: 'derived after generate',
        awgPresetLabel: 'Obfuscation preset',
        awgKeepZero: 'keep 0',
        awgS1Desc: 'must differ',
        awgJDesc: 'pairwise-unique',
        awgHDesc: '> 4 and unique',
        awgHWarning:
          'H1-H4 must be pairwise-unique, there are duplicates. Click Re-roll to regenerate.',
        naiveHostnameLabel: 'Public hostname',
        naiveTlsEmailLabel: 'TLS contact email',
        naiveMasqueradeLabel: 'Masquerade root',
        ssCipherLabel: 'Cipher method',
        ssNote:
          "Per-user password = the user's xrayUuid. Enable the shadowsocks protocol on the user.",
        mtprotoDomain: 'Masquerade domain',
        mtprotoDomainNote:
          'Changing the domain rotates secrets for ALL users, existing subscriptions stop working.',
        mieruMtu: 'MTU',
      },
    },
    deploy: {
      title: 'Deploy "{{name}}" to nodes',
      hint: 'Tick the nodes you want this profile on. Unticking deletes existing bindings (cascade - users lose URLs for that node). Port for new bindings: {{port}}.',
      port: 'Port for new bindings',
      portAutoHint: 'Auto-picked free port on the selected node. Override if needed.',
      portPlainHint: '{{port}}: the port clients expect. It is checked, not picked: the line under each ticked node says whether it is free there.',
      noNodes: 'No nodes - create one under Nodes first.',
      saved: 'Deployed: +{{added}} / removed: -{{removed}}',
      noChanges: 'No changes',
      submit: 'Save',
    },
  },
  profileEdit: {
    newTitle: 'New profile',
    newCrumb: 'NEW',
    engineRefused: 'The server refused: this protocol does not run on the chosen engine. SOCKS5 and HTTP are served by the xray core only.',
    // The BACK gate (0c7dcc7): an xray-family profile on sing-box, wrong field.
    singboxXrayRefused: 'On sing-box only REALITY (steal-others) over raw: field "{{field}}".',
    singboxXrayRefusedBinding: 'On sing-box only REALITY (steal-others) over raw: field "{{field}}" in the binding overrides.',
    singboxXrayField: {
      network: 'transport',
      security: 'security',
      realityMode: 'REALITY mode',
    },
    newSubtitle: 'PICK A PROTOCOL AND DEFINE THE TEMPLATE',
    editSubtitle: 'CHANGES REDEPLOY TO EVERY NODE RUNNING THIS PROFILE',
    // The door to POST /api/profiles/:id/test-connect (slice 31): the panel
    // probes every binding of the profile itself, no ssh to the node.
    testConnect: 'Test connection',
    // The multi-node deploy window: only it can remove a binding by unticking
    // and suggest a free port.
    deploy: 'Deploy to nodes',
    notFound: 'This profile no longer exists.',
    backToList: 'Back to profiles',
    create: 'Create profile',
  },

  // The connection-test window (slice 31). The panel probes every binding of
  // the profile from its own container, no ssh to the node.
  testConnect: {
    title: 'Connection test',
    scope:
      "The probe runs from the panel container's network: DNS, firewall, TLS handshake. It does NOT prove end-user reachability; their ISP may still block.",
    running: 'Probing every binding and every host…',
    failed: 'The probe failed',
    empty: 'This profile has no enabled bindings, nothing to probe.',
    rerun: 'Run again',
    close: 'Close',
    sniHint: 'The SNI we sent',
    certHint: 'The peer certificate CN: for REALITY this should be the masquerade site, not your domain',
    tlsHint: 'The negotiated TLS version: a REALITY masquerade target needs TLSv1.3',
    record: 'handshake record {{bytes}} of {{limit}} bytes',
    recordHint:
      'The longest record of the target\'s first answer, header included. The REALITY listener relays it and gives up on a record over {{limit}} bytes: no handshake ever completes.',
  },

  profileForm: {
    nameLatinOnly: 'Latin letters, digits, dot, _ and - only. No spaces or Cyrillic.',
    awgImportantTitle: 'What you should know about AmneziaWG 2.0:',
    awgImportant1:
      'Client: AmneziaVPN ≥ 4.8.12.9 or Hiddify Next ≥ 2.4. Older versions won\'t connect.',
    awgImportant2:
      'Pick a port on the next step ("Deploy to nodes"). Recommendation: ≤ 9999, e.g. 443 or 1234. Don\'t use 51820 - well-known WG-default, ISPs throttle it.',
    awgImportant3:
      'Migrating from AmneziaWG 1.0 - you need to regenerate all peer keys; old keys won\'t work.',
    deployHintAwgPort: 'For AmneziaWG: ≤ 9999, e.g. 443 or 1234. Don\'t use 51820.',
    // The old pair of texts read node.protocol as a restriction. It is a label
    // for the primary adapter, not a list of what the node can run: a node
    // labelled tuic serves an xray profile beside it every day. The question is
    // now whether the core this profile needs is among the ones the node
    // REPORTED about itself.
    nodeWillRun: 'This node reported that it runs {{wanted}}. The profile will be served.',
    nodeWillNotRun:
      'The profile needs {{wanted}}, and this node reported only: {{engines}}. The binding would be created with nothing to serve it: the subscription link would point at a port nobody listens on.',
    nodeEnginesUnknown:
      'This node has not reported which cores it runs, so there is nothing to say about compatibility. "{{protocol}}" is the label of the adapter installed as primary, not a capability list: a node with one label routinely serves profiles of other protocols beside it.',
    portRangeStart: 'Port range start',
    portRangeStartDesc: 'UDP port-hopping to evade RU TSPU. Empty = single port.',
    portRangeEnd: 'Port range end',
    portRangeEndDesc: 'Must be > start. The node\'s iptables range must cover this.',
  },
  recipes: {
    searchPlaceholder: 'Search recipes…',
    countLine: '{{shown}} of {{total}} recipes · built-in registry',
    emptyForKind: 'No built-in recipes for {{kind}}. Import your own or save this profile as a recipe.',
    title: 'Quick-setup recipes',
    subtitle: "Click and the fields below populate for the chosen scenario. Manual edits stay available.",
    appliedBadge: 'RECIPE APPLIED',
    appliedAlert: 'Applied: {{name}}',
    dpiLabel: 'DPI',
    speedLabel: 'Speed',
    registry: {
      title: 'Community registry',
      loading: 'Loading community recipes...',
      offline: 'Community registry is unreachable, built-in recipes only.',
      reason: {
        'not-found': 'Registry {{name}} not found (404): the repository is not there',
        unreachable: 'Registry {{name}} is unreachable, try later',
        invalid: 'Registry {{name}} did not answer with a recipe list',
        unknown: 'Registry {{name}} gave no recipes',
      },
      staleBadge: 'cached',
      official: 'official',
      community: 'community',
      byAuthor: 'by {{author}}',
      regionAll: 'All',
      region: {
        GLOBAL: 'Global',
        RU: 'RU',
        IR: 'IR',
        CN: 'CN',
        BY: 'BY',
      },
    },
    import: {
      button: 'Import',
      title: 'Import a recipe',
      hint: 'Paste a raw URL (your gist / GitHub) or the recipe JSON. It is validated, then you pick one to apply. Nothing is saved.',
      urlLabel: 'Recipe URL',
      jsonLabel: 'or paste recipe JSON',
      load: 'Load',
      pick: 'Pick one to apply:',
      none: 'No valid recipes found.',
      failed: 'Import failed',
      wrongProtocol: 'Nothing in there for {{protocol}} (only that protocol applies here).',
      hidden: '{{count}} recipe(s) for other protocols hidden.',
    },
    export: {
      button: 'Export as recipe',
      title: 'Export as recipe',
      hint: 'Save the current config as a recipe JSON you can commit to your own GitHub recipe source and share.',
      nameLabel: 'Name',
      namePlaceholder: 'My RU config',
      descLabel: 'Description',
      regionLabel: 'Region',
      download: 'Download JSON',
      filename: 'file: {{name}}.json',
    },
    cards: {
      'xray-reality-vision-raw': {
        name: 'REALITY + Vision (raw)',
        description: 'Canonical stealth - masquerades as a real HTTPS site',
        details:
          'VLESS + REALITY + Vision flow over raw TCP. To DPI the traffic looks like a normal HTTPS request to a major CDN site (Cloudflare/Apple/etc). Vision flow adds zero-copy splice - the fastest path with no masking overhead. Recommended default for most situations.',
        notes: [
          "Vision only works with raw - don't change the transport after applying",
        ],
      },
      'xray-reality-xhttp': {
        name: 'REALITY + xhttp (HTTP/2 chunked)',
        description: 'For aggressive DPI that cuts VLESS+raw',
        details:
          'VLESS + REALITY + xhttp transport. Traffic ships as HTTP/2 chunked-stream - looks like ordinary HTTP/2 to a CDN. ~10-15% slower than raw due to framing, but bypasses DPI that started cutting REALITY+raw in some ISPs. No Vision (xhttp does not support it).',
        notes: [
          "The path is randomised - don't share it publicly",
          "If REALITY+raw is blocked in your network, xhttp usually still works",
        ],
      },
      'xray-trojan-reality': {
        name: 'Trojan + REALITY',
        description: 'Password-auth instead of UUID, anti-probe defence',
        details:
          "Trojan via xray-core + REALITY. Users authenticate with a password (we reuse user.xrayUuid as the password). On bad auth the server returns a real HTTPS response from the decoy site - anti-probe defence. No Vision (Trojan doesn't support it). Useful for legacy clients that don't understand VLESS.",
      },
      'xray-reality-grpc-ru': {
        name: 'REALITY + gRPC (RU masquerade)',
        description: 'Decoy as a Russian CDN, for RU where cloudflare SNI is cut',
        details:
          'VLESS + REALITY + gRPC with serverName masqueraded as a major Russian CDN (Yandex avatars). Russian TSPU filters by SNI and targets cloudflare/foreign names, while a Russian CDN domain passes, plus a huge volume of legit traffic to hide in. Fingerprint firefox ("loyal" to TSPU JA3/JA4; chrome gets flagged). gRPC over raw: HTTP/2 framing is harder to fingerprint as a proxy. Mirrors live RU configs from 2026. NOTE: a single foreign node still dies under a whitelist shutdown; for shutdowns you need a cascade with a RU entry.',
        notes: [
          'serverName as a Russian CDN (avatars.mds.yandex.net); alternative ads.x5.ru. The node must reach dest:443 over TLS 1.3',
          'fingerprint firefox: chrome is flagged as suspicious by Russian TSPU',
          'serviceName is randomised so it does not fingerprint Iceslab',
          'Under a whitelist shutdown a foreign node will not save you - you need a cascade with a RU entry',
        ],
      },
      'hysteria-default': {
        name: 'Hysteria 2 (clean)',
        description: 'UDP, low latency, no obfs - for free regions',
        details:
          'Hysteria 2 over QUIC (UDP) without obfuscation. Lowest latency (UDP, no TCP handshake) and good throughput via Brutal CC. No obfs - DPI may flag QUIC traffic. Use in regions without active UDP-DPI.',
      },
      'hysteria-salamander': {
        name: 'Hysteria 2 + Salamander (RU mobile)',
        description: 'Obfuscation for UDP-DPI on Russian mobile carriers',
        details:
          'Hysteria 2 with Salamander obfuscation password. Each UDP packet is XOR-encrypted with a key derived from the password - DPI sees no QUIC signature. On Russian mobile carriers (Megafon/MTS/Beeline) clean Hysteria is often throttled to tx:0; Salamander typically passes through. Brutal CC tuned for 100 Mbps peaks.',
        notes: [
          "Obfs password generated randomly - don't lose it, clients need it",
          'Brutal CC 100/100 Mbps - adjust to your node\'s real bandwidth',
        ],
      },
      'awg-default': {
        name: 'AmneziaWG (default)',
        description: 'Default obfs parameters - works for most ISPs',
        details:
          'AmneziaWG (a WireGuard fork with DPI bypass). Default Jc/Jmin/Jmax + S/H obfuscation hides the WireGuard signature. Fits most providers. For aggressive ISPs try the "Iran-tuned" recipe.',
      },
      'awg-iran': {
        name: 'AmneziaWG (Iran-tuned)',
        description: 'Obfuscation tuned for Iranian DPI',
        details:
          "AmneziaWG with obfuscation parameters recommended by the Amnezia team for Iranian ISPs. Jc=4 (junk count), specific S1-S4 padding, H1-H4 header bytes. The default parameters fail Iranian DPI; these usually pass. Often helps on corporate firewalls too.",
      },
      'naive-default': {
        name: 'NaiveProxy (Caddy)',
        description: 'HTTP/2 proxy with Chrome fingerprint, probe-resistant',
        details:
          "NaiveProxy via Caddy fork. Traffic moves over HTTP/2 as a normal HTTPS request with the correct Chrome JA3 fingerprint. ACME cert from Let's Encrypt automatically. One of the stealthiest options where xray and hysteria are already banned.",
        notes: [
          'Fill hostname and tlsEmail manually - needs a real domain with an A-record on the node',
        ],
      },
      'ss-2022-blake3': {
        name: 'SS-2022 (blake3-aes-256)',
        description: 'Modern Shadowsocks - XChaCha20-level security',
        details:
          'Shadowsocks 2022 with the 2022-blake3-aes-256-gcm cipher. Modern alternative AEAD - better performance and probe-resistance than legacy chacha20. Supported by current clients (Shadowrocket, sing-box, Clash Meta); Outline does not speak the 2022 ciphers.',
      },
      'mtproto-default': {
        name: 'MTProto (Telegram)',
        description: 'Telegram-only - a separate use case',
        details:
          'MTProto proxy for Telegram. NOT a general-purpose VPN - Telegram traffic only. One shared secret across all users (upstream 9seconds/mtg limitation). Useful when Telegram is blocked but you want a fast pipe specifically for the messenger.',
      },
      'mieru-default': {
        name: 'Mieru (Chinese GFW)',
        description: 'Tuned against the Great Firewall - random padding',
        details:
          "Mieru by enfein - a modern stealth protocol with aggressive padding, designed against the Chinese GFW. Traffic looks like noise - no signatures. Supported by sing-box. Use when other protocols are cut in mainland China.",
      },
      'singbox-vless-reality-vision': {
        name: 'VLESS + REALITY + Vision (sing-box)',
        description: 'No REALITY probe-resist tuning',
        details:
          'VLESS + REALITY + Vision over raw on the sing-box engine. The same vless:// link as on the xray core, without the REALITY probe-resist tuning (fallback limits, xver): sing-box has no such fields.',
        notes: ['Vision works only with raw, do not change the transport after applying the recipe'],
      },
      'singbox-hysteria-clean': {
        name: 'Hysteria 2 (clean, sing-box)',
        description: 'UDP, low latency, no obfs, for free regions',
        details:
          'Hysteria 2 on the sing-box engine without obfuscation. The same protocol and hy2:// link as on its own daemon, one process fewer.',
      },
      'singbox-hysteria-salamander': {
        name: 'Hysteria 2 + Salamander (sing-box)',
        description: 'Obfuscation to get past UDP DPI on RU mobile',
        details:
          'Hysteria 2 on the sing-box engine with salamander obfs and a site masquerade on failed auth. Brutal 100/100 Mbps, port hopping 20000-50000.',
        notes: [
          'The obfs password is random, keep it, clients need it',
          'Brutal CC 100/100 Mbps, set it to the node\'s real bandwidth',
        ],
      },
      'singbox-ss-2022-blake3': {
        name: 'SS-2022 (blake3-aes-256, sing-box)',
        description: 'Modern Shadowsocks on the sing-box engine',
        details:
          'Shadowsocks 2022 with 2022-blake3-aes-256-gcm on the sing-box engine, multi-user. Outline does not speak the 2022 ciphers.',
      },
      'tuic-bbr': {
        name: 'TUIC (bbr, self-signed)',
        description: 'QUIC with BBR, for lossy mobile networks',
        details:
          'TUIC v5 on sing-box with bbr congestion control (sing-box defaults to cubic). The node issues its own certificate for the SNI in the form, clients need allow-insecure.',
        notes: ['Self-signed certificate: turn on allow-insecure in the client'],
      },
      'anytls-default-padding': {
        name: 'AnyTLS (default padding)',
        description: 'TLS-in-TLS with sing-box\'s default padding',
        details:
          'AnyTLS on sing-box. The padding scheme is the default one (sing-box uses it when padding_scheme is empty), and the SNI for the node\'s self-signed certificate.',
        notes: ['Self-signed certificate: turn on allow-insecure in the client'],
      },
      'shadowtls-v3-bing': {
        name: 'ShadowTLS v3 → real site',
        description: 'A real site\'s handshake, strict mode',
        details:
          'ShadowTLS v3 in strict mode: the TLS handshake is proxied to www.bing.com:443, Shadowsocks 2022 inside. No share link, handed out only in the sing-box and Clash (mihomo) formats.',
      },
      'telegram-socks5': {
        name: 'Telegram SOCKS5 (1080)',
        description: 'A tg://socks link for all three Telegram apps',
        details:
          'SOCKS5 on the xray core, login with the user\'s own username and password. No obfuscation: for networks where a proxy is allowed, not for getting past DPI. Port 1080 is offered when deploying to a node.',
        notes: ['The port is set when deploying to a node, 1080 by default'],
      },
      'telegram-http': {
        name: 'Telegram HTTP (3128)',
        description: 'Telegram Desktop only, the address is typed by hand',
        details:
          'HTTP CONNECT on the xray core, login with the user\'s own username and password. Telegram Desktop only, no link to add it. No obfuscation. Port 3128 is offered when deploying to a node.',
        notes: ['The port is set when deploying to a node, 3128 by default'],
      },
      'telegram-web-tproxy-websocket': {
        name: 'WEB (tproxy-server, websocket)',
        description: 'Websocket carrier, your own domain',
        details:
          'A t.me/webproxy link for Telegram Web: Caddy on 443, tproxy-server behind it, MTProxy behind that. The websocket carrier passes a CDN. No domain is filled in: it is your domain with an A record to the node. The panel cannot save a WEB profile yet.',
        notes: ['Type your domain and generate a key: the recipe sets neither'],
      },
    },
  },
} as const;
