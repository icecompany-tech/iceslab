export const profiles = {

  profiles: {
    emptyTitle: 'No profiles yet',
    emptyBody: 'A profile is one protocol with its settings: what a node listens with and what the client dials. Start from a recipe, it fills the risky fields for you.',
    emptyFromRecipe: 'Start from a recipe',
    emptyBlank: 'Blank profile',

    telegramPreview: {
      banner: 'Drawn, but the panel does not create it yet',
      bannerHint:
        'The fields below match the artboard and go nowhere: the backend does not accept this protocol yet. Pick MTProto to create a Telegram profile right now.',
      saveBlocked: 'This view cannot be saved yet, pick MTProto',
      socks5: {
        title: 'SOCKS5 CONFIG',
        authLabel: 'Auth method',
        authPassword: 'Username and password',
        authNone: 'No password',
        authNote:
          'RFC 1929. The pair comes from the user, like the Shadowsocks password: nothing to fill in here.',
        udpLabel: 'UDP associate',
        udpOn: 'Enabled',
        udpNote: 'Without it calls, DNS and games break: they all travel over UDP.',
        warn: 'SOCKS5 encrypts nothing by itself. It works as an entrance to a tunnel on your own machine or a trusted network, but open to the internet without a password it becomes a shared proxy for anyone who knows the address.',
      },
      http: {
        title: 'HTTP CONFIG',
        authLabel: 'Auth method',
        authBasic: 'Basic',
        authNone: 'No password',
        authNote:
          'The pair comes from the user. Digest is supported neither by the core nor by the Telegram client.',
        tunnelLabel: 'Tunnel',
        tunnelValue: 'CONNECT',
        tunnelNote: 'TCP only. UDP does not travel over an HTTP proxy at all, calls will not work.',
        warn: 'Basic is a username and password in base64, not encryption. Without TLS on top anyone on the path reads them. Such a profile must not face the internet bare: either a trusted network, or a host with TLS.',
      },
      web: {
        title: 'TELEGRAM WEB CONFIG',
        hostLabel: 'Web proxy host *',
        hostPlaceholder: 'proxy.example.com',
        hostNote: 'A base path is allowed. Port and HTTPS are baked into the view: always 443.',
        keyLabel: 'Key *',
        keyPlaceholder: '32 hex characters',
        keyHint: '32 HEX',
        keyNote:
          'This is the ordinary MTProxy client secret. All a person enters on their side is the host and this.',
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
    configButton: '{{core}} config',
    engine: {
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
      daemonVersion: 'Daemon version',
      latest: 'LATEST',
      older: 'OLDER',
      versionMenuTitle: 'Versions in the fleet',
      nodesWith_one: '{{count}} node',
      nodesWith_other: '{{count}} nodes',
      runsOn: 'runs on: {{names}}',
      andMore: 'and {{count}} more',
      coreVersionHint:
        'One process serves every xray-core profile on a node, so the version is per node, not per profile. Shadowsocks 2022 rides the same binary.',
      behind: '{{count}} of {{total}} nodes run {{version}}, they upgrade when a host lands on them',
      allCurrent: 'All {{count}} nodes already on {{version}}',
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
      noNodes: 'No nodes - create one under Nodes first.',
      saved: 'Deployed: +{{added}} / removed: -{{removed}}',
      noChanges: 'No changes',
      submit: 'Save',
    },
  },
  profileEdit: {
    newTitle: 'New profile',
    newCrumb: 'NEW',
    newSubtitle: 'PICK A PROTOCOL AND DEFINE THE TEMPLATE',
    editSubtitle: 'CHANGES REDEPLOY TO EVERY NODE RUNNING THIS PROFILE',
    notFound: 'This profile no longer exists.',
    backToList: 'Back to profiles',
    create: 'Create profile',
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
          'Shadowsocks 2022 with the 2022-blake3-aes-256-gcm cipher. Modern alternative AEAD - better performance and probe-resistance than legacy chacha20. Supported by all current SS clients (Outline, Shadowrocket, sing-box).',
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
    },
  },
} as const;
