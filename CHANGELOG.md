# Changelog

All notable changes to Iceslab are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

## v0.2.1 (2026-09-26)

The routing release. Everything that leaves a node now goes through one policy
layer: a cascade is carried by its own chain process on every hop, it can be
entered through Xray, Hysteria 2 or AmneziaWG, its legs can be VLESS,
Shadowsocks, Hysteria 2 or TUIC and can ride inside an AmneziaWG tunnel, a
direction can stand on a foreign VLESS or SOCKS server instead of one of your
nodes, and geo sets are managed by the panel and laid out on the nodes. Around
it: a node is its set of cores with no primary one, cores are added and removed
from the node page, every core version is pinned and checked, and roughly fifty
field findings from a clean-machine stand run are fixed. 516 commits since
v0.2.0.

Upgrading nodes: the agent has no self-update yet. After deploying the panel,
rebuild the agent on every node (`git fetch`, `go build`, restart), then rerun
`bootstrap-amneziawg.sh --restart-agent` on AmneziaWG nodes with the interface
down to move them to the 3.1 module; existing 1.x clients keep working on it.

### Added

- **The cascade runs as its own chain process on every hop.** A sing-box
  process the agent owns receives the legs, applies the route policy and picks
  the way out, instead of the cascade being drawn into the user-facing core's
  config. The entry hands its users over to it: an Xray entry by the socks
  user each profile arrives as, a Hysteria 2 entry by one listener for all its
  users, an AmneziaWG entry by TPROXY off its interface. Four protection rules
  are always drawn (DNS hijack, BitTorrent, port 25, sniffing), a chain that
  dies is reported by the node, and the panel refuses to save a cascade a hop
  cannot carry, naming the node and the core it lacks.

- **Legs choose their cell.** A leg between two hops is VLESS with REALITY (one
  keypair per receiving node, a short id per leg, a target measured to fit the
  8192-byte record limit REALITY relays), Shadowsocks 2022, Hysteria 2 or TUIC
  (with a TLS pair the panel mints and the dialling side pins). Every cell is
  proven by a live request between two engine processes in the test suite, not
  by `check`. A leg can also ride inside an AmneziaWG tunnel the agent raises
  between the two nodes, one tunnel per pair with its keys, inner /30 and port,
  rotated from the cascade page.

- **A cascade is entered through Hysteria 2 or AmneziaWG, not only Xray.** The
  entry protocol is one per cascade. Users of a Hysteria or AmneziaWG entry
  cannot pick a country (there is no UUID to carry the choice), so they leave
  through Auto and one entry policy the cascade names; the subscription hands
  their host out under the cascade's name and country. Switching the entry asks
  who leaves the cascade before it lets them go.

- **AmneziaWG 3.1 beside 1.x on one node.** Nodes get the 3.1 kernel module
  and tools, which carry the fleet's 1.x interface unchanged (measured on a
  throwaway machine: both generations side by side, junk parameters, padding,
  a 1.x client refused by the 3.1 interface, a plain WireGuard client refused
  by both). A node reports the generation its module speaks and whether its
  agent carries a 3.1 interface; a profile chooses its generation; a 3.1
  profile is refused onto a 1.x module or an older agent, and two generations
  on one node must not share a subnet. The 3.1 geometry (junk, header
  protection, decoys, padding, timers) is minted once per node and handed to
  AmneziaVPN 5.x as an `amnezia-awg2` key and a `.conf`; the panel never
  reuses stock decoys.

- **Named outbounds.** A foreign VLESS (raw over TCP, TLS or REALITY) or SOCKS5
  server the operator names becomes a direction of a cascade, drawn by the
  chain of the last position and offered to subscribers as a country like any
  other direction. Refusals name the direction and the node that lacks
  sing-box. `freedom` and `blackhole` exist in the model for imported configs
  and are not offered as directions.

- **Geo sets managed by the panel.** A set comes from a URL with a sidecar
  digest, from an uploaded file of up to 64 MB or from the two built-in
  releases fetched at start, as a v2fly `.dat`, a sing-box rule-set JSON or a
  MaxMind database, recognised by its bytes. Versions are verified and kept in
  the database, a URL set refreshes itself by conditional requests, a rule line
  suggests the tags of the set being typed, and rolling a version out lays the
  files on each node's agent, which points xray at them and restarts it once.
  The chain builds the rule-set for a tag the way xray reads it.

- **Route policies reach every core.** A node-level policy (domain, IP, port,
  protocol, network; direct, block, WARP or a cascade direction) is drawn by
  the core that applies it, and the node says which cores that is and where
  the policy does not apply. A cascade names an entry policy for the users who
  cannot pick one, a squad can switch a cascade off for its members, and the
  resolver belongs to the node.

- **A node is its set of cores.** No primary core, no protocol question: the
  installer takes `--engines a,b,c`, a node may run no core at all and take
  its cores later from the node page, every core bootstrap wires itself into
  the agent's env, `--remove` takes a core off (refused while it serves), and
  `--uninstall` leaves a clean machine (`--keep-cores` keeps the old
  behaviour). The node reports which cores it declares, which are installed,
  their versions, which ports they hold and what a cascade still needs from
  them; the panel shows all of it and never edits the set itself.

- **Every core version is pinned and judged.** One manifest of core versions
  with the pin, the ceiling and the known-bad ranges; installers download by
  sha256; every core row reads as recommended or pinned and says how to move;
  xray stays at or below 26.7.28 until the REALITY MLKEM change is measured.

- **Cores on IP-addressed nodes.** Native Hysteria 2 on a node addressed by IP
  serves an ECDSA certificate the panel mints with the IP as SAN, ten years,
  and every subscription format pins it (hy2 links with `pinSHA256`, mihomo,
  sing-box, xray, Surge, Loon); the core row shows the fingerprint and rotates
  it. Xray and Shadowsocks on a node resolve names through their own resolvers
  with the host's as the last fallback, so a dead host stub no longer takes
  every host of the core down, and a node whose resolver is dead reads
  degraded with the reason.

- **SOCKS5 and HTTP as profiles on the xray core**, with a login per user,
  replaced live without restarting the core and counted to the right person;
  the subscription hands them out in plain, Clash, sing-box and xray-json and
  the page offers `tg://socks` beside MTProto.

- **Recipes live in a public registry.** The panel ships no recipes of its own,
  only a pinned snapshot of `iceslab-recipes`, reads recipes by engine,
  protocol and subprotocol, imports one from a GitHub file page, a gist or
  pasted JSON, keeps the operator's own, hides registry ones, and exports a
  saved profile as a registry recipe with the path it takes in a fork.

- **Subscription page rebuilt**, with a lapsed page instead of an error
  object, the operator's own words for a lapsed subscriber, one table of which
  format carries which door and why the rest do not, an Outline dynamic key
  per Shadowsocks node, AmneziaWG keys drawn as the scanner of the app expects
  them (the app never accepted a `vpn://` string in a QR), and delivery
  settings that say format and address.

- **Port checks by socket.** A port is taken per transport, so Hysteria 2 on
  443/udp sits beside REALITY on 443/tcp; the check says who holds a port and
  how sure it is, a leg port and a profile port are one question asked both
  ways, and a UDP port inside a node's Hysteria hopping range is warned about
  before the save.

- **Screens that say why.** The node card lists every core with its version,
  the status carries the agent's reason in words, a cascade whose chain a node
  could not start says so on its card, deploying a profile onto a node that
  cannot serve it is refused before the save with the install line, and every
  refusal the server makes is spoken by the screen in the same words it
  predicted.

- **An Auto line in the subscription.** A cascade can now offer one extra entry
  that names no country: the client hands the choice to the cascade entry, which
  routes it through whichever direction it measures as fastest, per connection.
  A switch on the cascade page, off by default, because turning it on adds a row
  to every subscriber's server list.

  Two limits are deliberate. It needs at least two directions with nodes, since
  with one it would be the row above it under another name. And a user whose
  squad restricts exits does not get it: that restriction is enforced by which
  profiles the user is handed, and Auto can leave through any exit, so handing
  it out would walk straight past the operator's own allow-list.

  Worth naming for anyone who saw the earlier row: a preview Auto entry existed
  in the panel for a while and was fiction, removed in this same cycle. The
  entry had no rule for it, so choosing Auto egressed in the ENTRY country while
  the client showed an exit. The row is back only now that the node routes it.

### Changed

- **The panel and the node exchange facts, not labels.** A node's protocol is
  derived from its cores, its intended cores follow what the bootstraps wrote
  on the machine, the wizard learns which optional fields a server renders from
  the server, and every gate refuses only on a complete report: a partial list
  is enough to say yes and never enough to say no.

- **Installers are pinned and honest.** `ICESLAB_REF` and `ICESLAB_NODE_REF`
  default to the release tag, a core whose bootstrap fails no longer stops the
  install (the agent and the other cores go on and the end names the failed
  core and how to add it), a bootstrap check reads a command's whole output
  instead of racing `grep -q` under `pipefail`, an apt lock is stale only when
  nothing holds it, AmneziaWG packages of a foreign PPA are removed before the
  pinned build, and the Hysteria port-hopping range survives a bootstrap rerun.

- **Panel structure.** Contours own their locales and colours (one token per
  colour), the Prisma schema is split by domain, `src/lib` grouped by concern,
  the nav is a card with four groups, one sans face carried by the panel
  itself, the users table ports the artboard (columns panel, density, full
  screen, pointer reordering), and the demo build is gone.

- **CI.** The backend gets a linter, lint is a gate now that the debt is zero,
  one gate protects the branch, the pinned engines are installed so the chain
  config is asked rather than assumed, the geo conversion is compared with the
  pinned sing-geosite release on every run, and gitleaks scans the whole
  history with fixtures allowed by value, never by directory. Dependabot opens
  against `develop`, the branch work lands on; `main` is what installers pull.

- **A pooled cascade shows each of its lines once, not once per way in.** Two
  entries meant every row twice: two called Auto, two "ru → NL", two "ru → SE",
  and when the entries shared a transport the duplicates were labelled
  identically. The only thing differing between them is which of our machines
  the traffic enters through, which a subscriber has no way to judge.

  The lines are dealt across the pool's entries rather than all moved onto one:
  which entry carries a line is a pure function of (user, entry), so a refresh
  never moves anybody, and the deal is keyed on the line's tag, so adding or
  deleting a direction leaves everyone else's rows where they were. An entry
  left with nothing to offer is dropped from the subscription instead of being
  emitted as a plain direct server, which is how the entry-country leak happens.

  Named as a cost, not hidden: a subscriber no longer sees every way into a
  country, so if the entry under one row is blocked for them they can only move
  to another row, not to the same country through the other entry. A share link
  is one host, one port, one transport; a row that balances the way IN needs a
  client-side balancer, which only the config formats can carry, and that is not
  built yet.

- **A cascade entry re-measures its exits every minute instead of every five.**
  `leastPing` reads the last measurement and skips exits marked not alive, so
  that interval IS the failure-detection window. Found in the field: with the
  Dutch exit stopped, one entry had already moved to Sweden while the other kept
  dialling the dead one. A minute is also xray's own default for its health
  pinger; the cost is one request per exit per entry per minute.

- **A node whose core is dead no longer reports itself online.** Status had two
  values, so it answered "did the agent pick up the phone" rather than "is this
  serving anybody": a cascade entry sat with its core down for hours behind a
  green card, and the one place that knew (the poller already wrote "not
  running: xray" into the status message) is not somewhere anyone looks. There
  is now a third value, `degraded`, and the node card shows it in amber.

  Deliberately NOT treated as offline: the subscription's liveness filter keys
  on `unreachable`, so a degraded node keeps handing out the endpoints that do
  work, and the poller's re-push now includes it, because a core that will not
  start is exactly the one waiting for a config it can load.

### Fixed

- **Found on a clean-machine stand run, all fixed before this tag.** The
  default AmneziaWG MASQUERADE rule also matched loopback and rewrote the
  source of every query to the host's stub resolver, so xray lost DNS on any
  node with AmneziaWG (the rule now covers peer traffic only). A Hysteria
  port-hopping redirect swallowed the UDP of the agent's own leg tunnels and of
  AmneziaWG users leaving through TPROXY; the node now keeps its own ports out
  of the redirect and lets a caught flow go. A packet TPROXY steered into the
  chain was dropped by ufw in INPUT; it is accepted ahead of the host firewall.
  A transit routed every direction into the first one, because the rule used
  the process user instead of the connection's user, and `check` passed it. A
  push started a named core before stopping the one it no longer named, so two
  cores fought for 443/udp. xray on a transit fought the chain for the leg
  port. A cascade onto nodes without sing-box saved as "done" and served
  nothing; a hysteria-entered cascade was handed out as VLESS profiles the entry
  no longer carried. The `vpn://` key was too dense for a phone camera and, once
  slimmed, still unreadable by the app's scanner, which expects its own chunk
  format. The Loon lines used a grammar Loon does not read.

- **Cascades.** Every entry of a pool serves the cascade, not just the first; a
  pooled entry pushed nothing when edited or deleted; the observatory reached
  the builder but not the node; a save no longer rotates the secrets of every
  leg; a key the client did not send is not an edit; a leg switched to hy2 or
  tuic reaches both ends; a direction inherits the leg underlay unless chosen;
  a one-leg cascade's congestion choice reaches both ends; a deleted node in a
  cascade says which cascade refuses; a REALITY leg hides behind a target whose
  handshake record the engine can relay.

- **Nodes and cores.** A core's version is read past the JSON log lines before
  it and an uninstalled core reports none; the agent asks only serving cores
  for traffic; an idle core is not a hole in the policy; a restarted agent
  brings its cores back from disk; a config the core rejects never replaces a
  working one; the chain process lives by the agent's lifetime; holding no
  ports is an answer; unpacked binaries are root-owned; hysteria is pinned on
  both roads to it; mtproto users count online by the inbound they came
  through.

- **Subscription and clients.** The Loon lines read the obfuscation, the
  REALITY key and the pin they were ignoring; legacy AEAD Shadowsocks starts
  and authenticates; the seeded User-Agent rules follow the client catalog;
  cascade lines read in the right direction and stop repeating; an endpoint is
  identified by its host row, not its label; the AmneziaVPN key carries only
  what the app reads; the platform picker and the key picker keep their own
  state.

- **Panel.** Forms seed before the first frame instead of fighting the
  operator; the bootstrap countdown ticks; a refused save is handled, not
  thrown; a POST with no body is a request; the users' All squad comes back on
  a database that lost it; `/health` answers 503 when a dependency is down.

- **The agent asks the core before replacing a working config.** xray refuses a
  bad config whole, taking the user inbounds down with whatever was wrong, so a
  push that the core rejects used to turn a serving node dark and then burn its
  crash-restart budget proving it. The agent now runs the candidate through
  `xray -test` in a temp dir and, if the core says no, keeps the running config,
  starts nothing, and returns the core's own words to the panel. Validation
  happens against the operator's binary on purpose: the panel checks its own
  fragments in CI, but with our pinned build, and it is the node's core that has
  to accept them.

- **Saving a cascade that pushes to nobody says so.** An empty member list was
  silent, while the panel promised "saving pushes the config to all N nodes";
  it now logs at error level with the cascade named.

- **A POST with no body is no longer a 400.** Actions that take no input at all
  (reset traffic, revoke a subscription) were rejected whenever the caller sent
  `Content-Type: application/json`, which every HTTP client does by default, and
  the error said nothing about why. An empty body now reads as "no fields";
  malformed JSON still fails, and still fails loudly, because reading it as
  empty would turn a request meant to change something into a silent no-op.

- **The agent stops warning about a core that is not running.** A node waiting
  for its first config wrote two WARN lines every 30 seconds about failing to
  read stats from a core that was never started, which is a permanent warning
  about a normal state, and on a node whose core really did die it buried the
  one line that explained why under thousands that did not.

- **A cascade with a pool on its entry never pushed anything.** Saving one
  emitted its change event with the member list read from the legacy `hops`
  rows, and a pool on a position is one of the two shapes that deliberately
  cannot be folded into hops, so such a cascade has none. The list came out
  empty, no node was told anything, and the panel reported "Saving pushes the
  config to all 5 nodes again" while pushing to nobody. Creating a cascade
  already read both shapes; only editing and deleting did not, so a cascade
  could be created and then never changed again. Deleting one left its
  fragments live on the nodes for the same reason.

- **The observatory reached the builder but not the node.** Three paths
  hand-copied the same field list when turning a built hop config into the
  wire shape, and the v4 one copied everything except `observatory`. A node
  then received a `leastPing` balancer with nobody to measure the pings, which
  xray answers by refusing the ENTIRE config ("not all dependencies are
  resolved"): no inbound, no cascade, the core never starts. The config-validity
  test did not catch it because it feeds xray the builder's output, and the
  field was lost after that. All three paths now go through one mapper.

  Both faults met on one fleet: the entry cores of a live cascade sat dead for
  hours while the panel showed the nodes green, and the second fault meant the
  panel could not have delivered a fix even after the first was repaired.

- **The hosts screen shows how many people reach a host, not how many
  memberships.** It now reads the count v0.2.0 added to the API instead of
  summing each squad's member count, which reported one person in two squads as
  two. The page also stops fetching the squad list it no longer needs.

- **A mistyped install-time email no longer costs eleven minutes and says
  nothing.** The installer's ACME address check accepted any non-space
  characters around the `@`, so a single Cyrillic letter (one unswitched
  keyboard layout) passed it, went into `.env.production`, and the panel then
  refused to boot on it at step 9 of 9. All the operator saw was "container is
  unhealthy" plus a tail of the installer's own output, which named nothing.

  The check is now ASCII-only, matching what the panel accepts, and says to look
  at the keyboard layout. When the stack still fails to come up, the installer
  prints the backend's own log, where the reason is one line.

### Removed

- **The demo build and its seeded dataset.** A `VITE_DEMO_MODE` frontend build
  served the panel read-only from invented fixtures for an iframe on the
  marketing site, and a `DEMO=1` backend switch plus `seed:demo` /
  `demo:metrics` scripts kept a fake fleet looking alive by turning the node
  pollers off. It existed to make a screenshot, and it cost more than it
  earned: fixtures to keep in step with every DTO, a build-time flag threaded
  through router setup and three forms, a clock indirection in four more files,
  and a scheduler that could be told to stop watching nodes. The panel is easier
  to reason about with one build and one clock.

### Known limitations

- The agent does not update itself: after a panel deploy, rebuild it on each
  node over ssh.
- A REALITY inbound dials its target through the host resolver on every
  handshake; sing-box and native Hysteria resolve through the host as well. A
  node whose resolver is down reads degraded with that reason.
- A squad that restricts a cascade's exits by node does not see directions on
  named outbounds; the allow-list is keyed by node.
- Users of a Hysteria or AmneziaWG entry share the cascade's entry policy; a
  per-user policy on such an entry is not built.

## v0.2.0

The operator release. Iceslab gains the API surface another program needs to
drive it (lookups, bulk actions, usage history, signed webhooks), the groundwork
for moving a live userbase in from another panel, and cascades rebuilt around
positions and directions so a tier keeps its identity when the fleet changes.
The panel itself moved from modals to pages, and the node-agent learned to hold
several inbounds and to restart a core before it runs the host out of memory.
Field-verified against a seven-node fleet.

### Security

- **The panel UI is no longer published on every interface.** The frontend port
  was mapped as `0.0.0.0:8080`, so on a domain install the admin UI answered
  plain HTTP to the whole internet, bypassing the TLS proxy in front of it -
  and the login password went across the wire in the clear. The installer's own
  firewall step reported "default deny incoming", which was true and beside the
  point: **a docker-published port is DNAT'd before ufw's filter chains run, so
  the firewall cannot close it.** The bind address is the only control, and it
  is now `FRONTEND_BIND`, defaulting to `127.0.0.1`.

  Reported from a clean community install (#33) and reproduced against our own
  panel, which returned HTTP 200 on `:8080` from the public internet while
  `ufw status` listed no rule for it.

  ⚠ **Action required for installs WITHOUT a reverse proxy.** If you reach the
  panel directly at `http://<ip>:8080`, add `FRONTEND_BIND=0.0.0.0` to
  `.env.production` before your next deploy, or the port will stop answering.
  Installs behind Caddy/nginx/Traefik on the same host need no change; a fresh
  install picks the right value for its mode automatically.

- **AmneziaWG mimicry values are validated as hex.** They are interpolated into
  the interface's `PostUp`, so anything else was a command-injection surface on
  the node.
- **Test-connect will not probe your own network.** An SSRF guard on the target,
  plus ReDoS and cache hardening on the subscription response rules.
- **API token scopes are checked against a known-scope allowlist** rather than
  accepted as given.
- **The honeypot blacklist skips non-routable addresses**, so a probe from a
  private range can no longer get an operator's own network blocked.
- **A cap on distinct device rows per user**, so a `/sub` audit loop cannot fill
  the disk.
- Dependency advisories closed, and CI now scans for secrets, lints Go, and
  proves the built image boots.

### Added

- **An API another program can run the panel with.** Look a user up by Telegram
  id, username, subscription token or email; apply one action (extend, reset
  traffic, revoke, delete, enable, disable) to up to 500 users at once; read one
  user's traffic history for a period, optionally split per node. Telegram id
  and email answer with a list rather than one record, because one id really can
  belong to several accounts.
- **Signed outbound webhooks.** The panel now tells subscribers when a user is
  created, changed, expires, hits a limit, has traffic reset or is deleted, and
  when a node goes down or comes back. HMAC-SHA256 over `<timestamp>.<body>`, so
  a bot can stop polling.
- **Groundwork for importing a live userbase.** A user can be created with
  values carried from another panel (expiry, subscription token, credentials,
  registration date), and every imported row records where it came from, so a
  second import run updates rather than duplicates.
- **Cascades by positions and directions.** A direction now keeps its identity
  across saves: deleting one exit no longer renumbers the rest, which used to
  move a subscriber from one country to another without anyone touching their
  account. Exits can be selected per subscriber through `vlessRoute`, exposed in
  the subscription per cascade, and a save reports provisioning status per hop.
- **Squads got granular.** A squad can hand out only some hosts of its profiles,
  restrict which cascade exits it grants, and carry its own route policies (the
  "no ads" split), each scoped to the squad that granted it.
- **A node-agent that holds a fleet's worth of state.** Several xray inbounds on
  one node; a memory ceiling that restarts the core before the kernel OOM-kills
  it, with the restart tally and headroom on the node card; an unconfigured core
  told apart from a failed one; core version reported and gated for cascade exit
  selection.
- **Hosts as a first-class thing.** Create one by naming a profile, node and
  port and the binding underneath appears by itself; host fields are resolved
  per profile so the form only offers what that protocol actually emits, and an
  SNI the node will not serve is rejected on save.
- **Community recipe registry, plus bring-your-own sources.** Import a profile
  recipe from a registry or your own list, export your own.
- **Subscription reach.** The `xrayjson-array` format with the full routing
  surface per config, the AmneziaVPN `vpn://` key, and `SUBSCRIPTION_PUBLIC_URL`
  for serving `/sub` from its own domain.
- **`iceslab.sh`, one menu for ops.** Deploy, logs, backup, restore and cleanup
  behind a single entry point that explains each action before running it.

### Changed

- **A deployed node now always appears in subscriptions.** Entries were capped
  at three per profile, so a healthy, serving node could be missing from a
  subscription with nothing anywhere explaining why. From the operator's chair
  that is indistinguishable from a fault, and it was reported as one.

  Subscribers receive every node they are entitled to. The list is ordered per
  subscriber by rendezvous hash, so clients (which dial the first entry, and few
  subscribers ever change that) still spread across the fleet instead of all
  landing on whichever node the query returned first. The order is stable for a
  given person, and a node going down reshuffles only the people who were on it.

  The cap is kept as an opt-in setting, `subscriptionEntryPoolSize`: an operator
  who would rather a leaked subscription expose a slice of their entry surface
  than all of it can set it. `0`, the default, means no cap.

- **The API reports host reach as people, not memberships.** `GET /api/hosts`
  now returns, per host, how many squads hand it out and how many DISTINCT
  people that is, honouring squad narrowing. The hosts screen was adding up each
  squad's member count, which read one person in two squads as two people; it
  cannot be fixed there, since the squad list carries totals rather than user
  ids. The screen switches to this in the next release.

- **A node that stops answering leaves the subscription, after a grace period.**
  Ninety seconds, three failed polls: long enough that a blip changes nothing,
  short enough that a genuinely dead node stops being handed out. Its users are
  redistributed across the rest rather than herded onto one replacement.

- **The panel rebuilt around pages.** Users, hosts, profiles and cascades moved
  out of modals into pages with a drawer for detail. The user row now says one
  thing per mark: the pill is the account's state, the dot is the connection,
  and the column that used to be labelled "Subscription" while holding last-seen
  is now labelled for what it holds.

- **Cascade links carry BBR, TCP Fast Open and multiplexing, and drop QUIC at
  the entry.** A page of forty requests used to pay forty full round trips
  through the whole chain; the operator's report of "loads heavily" was that,
  not the second hop. QUIC at the entry stalls tunneled video, so it is refused
  there deliberately.

- **Subscription names lead with the flag and the host.** Cascade ways out lead
  with the exit country instead of gluing the entry host onto every line.

### Fixed

- **Adding a user no longer restarts the core.** The live path pushed a user to
  a tag the running config did not have, so every single addition fell back to a
  full config regeneration and restart, dropping every connection on that node.
  On a fleet with one dead node the work tripled, since the retry hit the others
  again.
- **A deleted user stopped coming back.** Deletion is soft, and the query that
  hands a node its user set did not filter on it, so the next inbound change
  re-seeded people whose accounts had been removed. Their subscription link was
  dead, but the credentials their client already held kept working.
- **A blank optional setting no longer crash-loops the panel.** One empty line
  in `.env.production` failed URL validation at boot; blanks now read as unset,
  and a test checks every optional setting for the same trap.
- **Settings that never reached the container.** The webhook bus and the
  subscription addressing knobs existed in the schema, the env template and the
  code, but were missing from the compose passthrough, so an operator who filled
  them in got silence. A test now compares the config schema against compose.
- **`vlessRoute` is rendered as a string, not an array.** As an array the engine
  accepted the config and quietly routed both entries the same way, which is the
  worst shape a bug can take: no error anywhere and a subscriber in the wrong
  country.
- **A route policy stays inside the squad that granted it.** One squad's "no
  ads" variant was appearing on another squad's exits, which the operator never
  configured and could not remove.
- **Traffic accounting across mixed nodes.** Cumulative counters are now flagged
  per user rather than assumed per node, so a fleet mixing cumulative and delta
  reporting bills correctly.
- **AmneziaWG configs iOS can parse**, zero `S3`/`S4` and empty pre-shared keys
  omitted rather than emitted; peer allocation retries further before giving up;
  the default `PostUp` opens FORWARD on hosts whose policy is DROP.
- **The node-agent stopped serving an inbound the panel deleted**, and reports
  serving nobody as a state rather than as a render failure.
- Subscription cache invalidated on node and host edits, host address override
  winning over a profile hostname, hysteria status read from systemd instead of
  a subprocess never spawned, ufw retried on lock contention, the
  append-only subscription-events table pruned, and the rest of the audit tail.

## v0.1.9

The sing-box engine release. Iceslab gains a second proxy engine beside its
native cores, three transports it unlocks (TUIC, AnyTLS, ShadowTLS), and a
per-profile choice of which engine serves the mainstream protocols. Plus
Cloudflare WARP as a per-node egress, a latency-balanced "auto" cascade that
picks the fastest exit per connection, and a batch of node, stats and deploy
fixes. The new transports, WARP and the balancer cascade ship functional with
real-network field validation in progress (the alpha maturity bar).

### Added

- **sing-box engine.** A second proxy engine alongside the native cores. The
  node-agent dispatches by (protocol, engine) pair, so a protocol can be served
  by its native core or by sing-box, with per-user traffic stats read over the
  v2ray API. Enabled on a node that has sing-box installed (`--with-singbox` in
  the node installer).
- **TUIC (v5).** A QUIC transport with mandatory TLS and native UDP relay, served
  by the sing-box engine. New profile type, emitted into the `tuic://`, sing-box
  and Clash subscription formats.
- **AnyTLS.** A TCP-over-TLS, password-only transport via sing-box. New profile
  type and subscription output.
- **ShadowTLS v3.** A TLS-camouflage wrapper: the node performs a real TLS
  handshake to a whitelisted domain (default `www.microsoft.com`) and tunnels
  Shadowsocks underneath, so the connection looks like plain browsing to that
  site. Per-user auth is the ShadowTLS password; the inner Shadowsocks key is
  server-wide and auto-generated. No share-link URI (emitted only into the
  sing-box and Clash formats, which carry the plugin natively).
- **Engine choice per profile.** VLESS, VMess, Trojan, Shadowsocks and Hysteria2
  can now run through the sing-box engine instead of their native core, chosen in
  the profile form. Native stays the default, so existing profiles are unchanged.
- **Cloudflare WARP egress, per node.** A node can route its inbound's user
  traffic out through Cloudflare WARP (an Xray `wireguard` outbound), giving it a
  Cloudflare egress IP. The panel registers a free WARP device and injects the
  credentials into the node's config; opt-in per node via a toggle, existing
  nodes keep direct egress.
- **Latency-balanced cascade (the "auto" node).** A new cascade mode where one
  entry balances across N parallel exits by round-trip time (an Xray observatory
  feeding a `leastPing` balancer), so a client connects to a single node and each
  connection is routed through the lowest-latency exit. Built as an "optimal
  location" node for clients that have no client-side url-test. The sequential
  chain mode is unchanged and stays the default; pick the mode in the cascade
  form.

### Changed

- **Hysteria2 QUIC throughput tuning on the node.** The node installer now raises
  the UDP socket buffers (`rmem_max` / `wmem_max` to 16 MiB) and switches the
  qdisc and congestion control to `fq` + BBR, so a cross-continent Hysteria2 node
  is no longer throttled to a fraction of its bandwidth by the distro-default
  receive-buffer ceiling on high-BDP (fast and distant) links.

### Fixed

- **A live user-add no longer restarts Xray.** The runtime add payload omitted
  the inbound's listen and port, so Xray re-validated it as an AnyIP listener
  with no port, added nobody, and every add silently fell back to a full restart
  that dropped all live connections (and on a cascade entry, the whole chain).
  The payload now carries the port, so adds stay live.
- **A reset per-user counter no longer spikes a quota.** When a user's per-poll
  counter dropped below its stored snapshot (a core restart, or one of the user's
  inbounds missing from a single poll), the panel billed the whole residual as
  one delta, so a user line could jump tens of GB in one tick. It now re-baselines
  to a zero delta, matching the node-level path.
- **Shadowsocks 2022 keys served by sing-box are valid.** A sing-box Shadowsocks
  user was handed the raw account UUID as its pre-shared key, which is not a valid
  SS2022 key; the PSK is now derived correctly. Existing Shadowsocks users must
  re-import their subscription (the key changed).
- **sing-box subscriptions import on Happ and the CLI.** The sing-box config
  shipped with no `inbounds`, which Happ and the sing-box CLI reject as invalid,
  dropping them to the routing-less plain format. It now emits one minimal `tun`
  inbound, with no local SOCKS/HTTP proxy inbound so there is no localhost leak
  surface; GUI clients still override it with their own tun.
- **A cascade exit's firewall rule lands under the hardened unit.** The
  node-agent's `ProtectSystem=strict` service did not grant write access to
  `/etc/ufw`, so a cascade exit's allow-from-entry rule was silently dropped and
  the exit showed dead in the balancer. `/etc/ufw` is now in the unit's
  ReadWritePaths.
- **Unattended deploy needs no flags.** `deploy.sh` stopped on the detached HEAD
  the installer leaves when `ICESLAB_REF` was unset. It now defaults to `main`
  (and the checkout re-attaches HEAD to it), so a bare `deploy.sh` just tracks the
  trunk; pin a release with `ICESLAB_REF=<tag>`.

### Docs

- **Contribution provenance.** CONTRIBUTING now asks contributors for their own
  commit messages and PR descriptions with no AI co-author trailers, and the
  stale `develop`-branch note is dropped (the project is trunk-based on `main`).

## v0.1.8

Operator production-readiness, surfaced by dogfooding a real paid service on
Iceslab: kill or rotate a leaked subscription link, reset a user's traffic on
demand, and scope API tokens to least privilege. Plus multi-hop cascades
validated end to end on real nodes for the first time (RU entry to EU exit, the
client's egress IP becomes the exit's), which surfaced and closed two real
defects along the way, a read-only demo build of the panel for the landing page,
the full set of well-known client detection rules with an inline enable toggle,
a per-profile reach count that ignores deleted users, and a batch of form and
stats polish.

### Added

- **Revoke and rotate a subscription link.** Kill a leaked or abused link (it
  returns 403 until rotated), or rotate it to issue a fresh token that kills the
  old link immediately. From the Users page or the API.
- **On-demand traffic reset.** Zero a user's used traffic and lift a traffic
  limit in one action (period-billing top-up) without waiting for a cron reset;
  a limited user goes straight back to active and is re-provisioned.
- **API tokens enforce scopes.** A token can be least-privilege now: one scoped
  to users plus subscription-read cannot reach settings, nodes, or token
  management. Existing full-access tokens are unaffected; pick a scope preset
  when creating a token.
- **Import an existing subscription token on user create.** Operators migrating
  in keep their clients' current links instead of forcing a re-import.
- **Read-only demo build of the panel.** A VITE_DEMO_MODE build serves the real
  UI from local fixtures (auto-login, every change a no-op) for embedding on a
  landing page, and reads ?lang= for its start language. Tree-shaken out of the
  normal build.
- **All well-known subscription clients are seeded.** The User-Agent detection
  rules now cover the clients that previously had no rule and fell through to the
  base64 list they cannot parse: Surge and Surfboard, Quantumult X, Loon, Outline,
  XKeen, plus Karing, Throne and FoXray, and explicit plain-list rules for
  Shadowrocket, Streisand, V2Box and Happ. Idempotent seed.
- **Inline enable/disable toggle on the subscription rules table.** Turn a rule
  on or off in place without opening the editor; optimistic with rollback on
  failure.

### Fixed

- **Enabling a cascade now reaches the nodes.** Creating, editing or deleting a
  cascade emitted no event, so the chaining fragments only lived in the database
  and never pushed to the hop nodes until some unrelated profile or binding edit
  fired a re-sync. The cascade service now re-pushes every node that is or was a
  hop (so disabled or removed hops also drop their fragments).
- **The node-agent opens the cascade link port itself.** The inter-hop link
  listens on a high port that install-time firewall rules do not know about, so
  it previously had to be opened by hand (`ufw allow from <entry-ip> ...`) or the
  forward was silently dropped. The panel now sends the link port and the peer
  hop's address with the cascade fragment, and the agent opens UFW for it,
  restricted to that peer (resolving a hostname to its IP, falling open only if
  it cannot be pinned). Applied on push and re-ensured on boot.
- **A node reporting one user twice no longer rolls back its stats.** When a node
  reported the same user on two protocols (for example VLESS plus Shadowsocks),
  the cumulative-snapshot upsert received a duplicate row and Postgres aborted the
  whole transaction, so that node recorded nothing. The duplicates are now summed
  into one entry per user. This was why cascade nodes showed zero traffic.
- **Per-profile user reach excludes deleted users.** A profile's "users with
  access" count included soft-deleted users (their squad membership is kept for
  restore), so one live user could read as four. The reach query now joins live
  users only.
- **Implausible per-poll traffic deltas are discarded.** A node reporting more
  than a terabyte for one user in a single 30-second poll is re-billing its
  lifetime counter (an outdated agent), not real traffic; the panel now drops such
  a delta and logs it instead of corrupting quotas and node history.
- **Form and tab polish.** New profiles default to Xray (REALITY) instead of
  Hysteria, the REALITY option rows bottom-align instead of staggering, the long
  node bootstrap payload wraps inside its box instead of overflowing, and the
  favicon is wired into the page.

## v0.1.7

The censorship-survival work from v0.1.6 made functional and field-ready: the
REALITY self-steal vertical actually works end to end now, traffic accounting is
zero-loss across restarts, and admin two-factor is hardened against code replay.
Plus the full advanced Xray option surface and an opt-in probe-resistance knob,
TLS-fragment, per-user and China routing presets, a Shadowsocks cascade link, a
realistic self-steal fallback, and live Shadowsocks user management.
Self-steal and the node-hardening toggles ship functional with real-network
field-validation in progress (the maturity bar v0.1.6 used for its experimental
features).

### Security

- **TOTP replay rejected within the validity window.** A one-time code can no
  longer be reused inside its 30-second step: the last-accepted step is recorded
  and a login presenting a step at or below it is refused. Closes the small
  replay window the initial TOTP work left open.

### Added

- **Advanced Xray options, tabbed.** The profile form's Xray section moved to
  tabs (REALITY / TLS / Transport) and exposes the previously hidden option
  surface: REALITY xver and max-time-diff, TLS reject-unknown-SNI, XHTTP mode and
  request-padding, gRPC multi-mode.
- **REALITY fallback rate-limit (probe resistance, opt-in).** An optional
  per-direction throttle on unverified fallback connections, so a scanner that
  fails REALITY auth is forwarded to the target slowly and sees a slow site
  rather than a full-speed proxy. Off by default: the throttle is itself a
  detectable pattern, so it stays an expert opt-in.
- **TLS-fragment (opt-in, Xray-JSON).** A subscription can fragment the client
  ClientHello so SNI-based DPI cannot cleanly match the handshake. Off by
  default; toggle via a panel setting or the `?fragment=` query. Emitted only
  into the Xray-JSON format (a freedom fragment outbound the proxy dials
  through); intentionally not sing-box (the upstream field is unstable).
- **Per-user routing override + operator custom domain lists (R3).** A routing
  preset can now be set per user (winning over the squad and global defaults),
  and an operator can define direct / proxy / block domain lists emitted into the
  Xray-JSON and Clash routing rules. Empty or unset leaves output unchanged.
- **China routing preset (cn-split, H2).** A China-direct mirror of ru-split:
  China domains and IPs resolve and egress direct (clean DNS via AliDNS),
  everything else tunneled. Across Xray-JSON, Clash and sing-box.
- **Shadowsocks cascade link cell (C3b).** A multi-hop cascade can use a
  Shadowsocks-2022 inter-hop link in addition to VLESS, including mixed chains.
  Node-to-node link only; the entry hop still does the DPI evasion.
- **Realistic self-steal fallback (G1, opt-in).** A self-steal node can
  reverse-proxy unverified probe requests to a real upstream site instead of the
  stub page, so a deep prober sees genuine content. Off by default (static
  landing); any upstream error falls back to the static page.

### Changed

- **Zero-loss traffic accounting.** Per-user stats are now drained
  non-destructively: the node reports cumulative counters and the panel computes
  the delta against a stored per-node-per-user snapshot in the same transaction
  as the increment. A failed or retried stats write can no longer lose a slice of
  a user's traffic the way the previous reset-on-read drain could.
- **Frontend API base URL defaults to same-origin in production.** Production
  builds talk to their own origin instead of a hardcoded localhost, so the panel
  works served from anywhere without a build-time override.
- **Dependency audit gate kept clean.** Two transitive advisories pulled to
  patched versions via overrides so the production audit gate stays green.
- **Live Shadowsocks user management (N1-SS).** Adding or removing a Shadowsocks
  user now goes through the running core's runtime API with no restart (live
  connections preserved), matching the Xray live-management path, with the same
  config-restart fallback when the runtime call cannot be made.
- **Stricter REALITY target check (H1).** The pre-deploy test-connect now also
  verifies the masquerade target negotiates HTTP/2, not just TLS 1.3, and
  surfaces a single health note: a CDN-grade dest should speak both.

### Fixed

- **REALITY self-steal now works end to end.** Two wiring defects made self-steal
  silently degrade to borrowing an external TLS identity (the mode that
  mismatches under aggressive DPI): the camouflage-mode field was dropped by the
  config schema before it reached the node, and the per-node domain was pushed
  under the wrong wire key so the node received an empty server-name list. Both
  fixed, plus the node is re-pushed when its domain changes. The self-steal
  vertical is now functional (real-network validation pending).
- **Add and remove of a user converge under rapid status changes.** A user
  toggled active and limited in quick succession could leave the node user set
  out of sync with the panel; the sync now gates on the live desired status so
  the node converges to the correct set.
- **Node firewall self-heals on boot.** UFW was only opened for an inbound's port
  inside the applyInbounds push handler, so a node that restarted (or whose rule
  was lost to a reimage, or to a transient `ufw allow` that has no retry) could
  run its core with the port closed until the next push. The agent now re-ensures
  UFW for every persisted inbound on startup. Caught live: xray reachable from
  abroad but the binding port was firewalled.

## v0.1.6

The largest release since the alpha opened: a censorship-survival toolkit for
hostile networks (routing presets, multi-hop cascades, REALITY self-steal), live
user management with no restarts, admin two-factor auth, operator analytics and a
Telegram bot, far broader client-app coverage, and a deep performance and
reliability audit across both the panel and the node-agent.

### Security

- **Admin two-factor auth (TOTP).** Optional RFC6238 TOTP on the admin login,
  with a guided enrollment (enable requires a confirmed code, so you cannot lock
  yourself out) and a disable flow. Recovery is a single SQL update if a device
  is lost. Additive: existing logins are untouched until an admin opts in.

### Added

- **Routing presets with split-DNS.** A subscription can carry a `ru-split`
  preset (ads and local destinations resolve and egress direct, everything else
  is tunneled), rendered correctly into the Xray-JSON, Clash and sing-box
  formats with a matching split-DNS block so lookups do not leak. Selectable per
  subscription, per squad (override), or via a `?routing=` query, plus a raw
  custom-rules editor for hand-written Xray routing rules.
- **Multi-hop cascades (experimental).** Chain nodes entry -> transit -> exit:
  the client connects to an entry node and traffic is forwarded hop to hop to an
  exit that egresses direct. Full operator UI (hop builder, reorder, validation)
  plus node-agent forwarding for the Xray vless cell. Built for networks where a
  single foreign hop is blocked; field validation is in progress.
- **REALITY self-steal (experimental).** A REALITY mode where the node runs its
  own local TLS fallback and presents its own domain, so the SNI and the server
  IP stay consistent (the mismatch that gets a borrowed-SNI REALITY connection
  mangled on aggressive DPI). Selectable per profile.
- **Live user add and remove with no restart.** Adding or removing an Xray or
  Shadowsocks user now goes through the core's runtime management API, so live
  connections are never dropped. It falls back to the previous config-restart
  path only when the runtime call cannot be made, so it can only improve on the
  old behaviour.
- **Operator analytics.** Dashboard bandwidth now shows deltas against the prior
  period on every window, plus a new Insights page: a subscription-request
  breakdown by client app and a HWID device-count distribution, both computed
  from already-stored data with no new tracking.
- **Operator Telegram bot.** A read-only bot answering `/status` and
  `/user <name>` to the operator chat, plus a daily digest of users near expiry
  or near their traffic cap.
- **Signed outbound webhooks.** User, profile and node events are forwarded to
  configured URLs with an HMAC-SHA256 signature over the payload.
- **Broader client-app coverage.** New subscription formats: XKeen (Xray confdir
  for Keenetic routers), Outline / SIP008, Surge, Quantumult X and Loon.
- **Multi-core node UX.** Add a second protocol to an existing node from the node
  view, with an auto-picked free port and a human-readable message when a port is
  already taken. Plus a masquerade REALITY recipe and a test-connect that probes
  the REALITY dest for resolvability and TLS 1.3.
- **Per-squad defaults.** A squad can carry a routing-preset override and a
  default HWID device limit.

### Changed

- **Panel performance pass.** Response schemas for fast JSON serialization on the
  hot dashboard and user-list endpoints, in-process caches for subscription
  settings, squad bindings and blacklist lookups (all write-busted), bulk
  single-statement traffic upserts and AmneziaWG peer pre-allocation, cursor
  pagination on backfill, and lazy-loaded frontend routes (initial bundle cut by
  about a third).
- **Node-agent reliability.** Adapter locks are split so a multi-second core
  restart no longer blocks health checks or the panel's push workers, a bounded
  restart-on-crash supervisor backs every spawned core, subprocesses are
  group-killed so no orphans leak, and stats and health probes run concurrently
  with cached AmneziaWG and UFW reads plus zero-user short-circuits.

### Fixed

- **AmneziaWG runaway traffic.** AWG reported kernel-cumulative counters where the
  panel expected per-poll deltas, so a peer's lifetime total was re-billed on
  every poll and drained quotas. The agent now emits true deltas (baseline on
  first sight, so an agent restart never re-bills the backlog).
- **Editing a limited or expired user no longer fails.** Saving such a user
  returned 400 on every attempt; it now reactivates correctly, and a 0 GB
  traffic limit is read as unlimited.
- **Per-user stats no longer error on multi-inbound users.** A user present on
  more than one inbound of a node tripped a Postgres conflict (21000); per-user
  rows are aggregated before the bulk upsert.
- **Smaller audit fixes.** IPv6-aware subscription host parsing, a human-readable
  port-conflict 409 naming the node and profile, an online-aware node status dot,
  a flag-emoji guard for non-ISO country codes, a bounded Hysteria auth-callback
  body, and a settings form that re-seeds from the server after save.

## v0.1.5

Full Xray protocol matrix: VLESS, VMess and Trojan over any transport and any
security mode, behind a guided picker. Plus an update-available indicator and a
round of VPS hardening.

### Security

- **nginx ships hardening headers.** `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `server_tokens off` on every response. CSP is left to the
  operator so a wrong policy can't silently break the SPA.

### Added

- **Full Xray protocol matrix.** A profile can now run VLESS, VMess or Trojan over
  any of the six transports (raw, WebSocket, gRPC, xHTTP, HTTPUpgrade, mKCP) and
  any security mode: REALITY, plain `none` (for a CDN that terminates TLS itself),
  or node-terminated TLS with your own certificate. A guided three-step picker
  (protocol, then transport, then security) reveals only the fields each
  combination needs, and every combination is emitted correctly into the
  raw/base64, Clash, sing-box and Xray-JSON subscription formats.
- **Update-available indicator.** The sidebar shows an accent dot linking to the
  release when a newer version ships. The panel checks the latest GitHub release
  (cached 6h, best-effort: it never blocks a request or breaks if GitHub is
  unreachable, and needs no token on the public repo).

### Changed

- **Subscription formatters are security-aware.** Clash, sing-box and Xray-JSON
  hardcoded REALITY for every Xray endpoint, so a `none` or `tls` profile would
  have produced a broken client config. They now render the correct security
  block per endpoint and carry all three subprotocols.
- **VPS resource and secret safety.** Redis is capped (`--maxmemory` with
  `noeviction`, so a runaway can't OOM a small host and queued jobs are never
  silently dropped), and `deploy.sh` snapshots `.env.production` (the only on-host
  copy of the JWT secret, DB password and node mTLS CA) to a timestamped backup
  ring before each deploy.

## v0.1.4

Reliability hardening after a deep code audit: the bug-fix campaign, a deploy/
update fix so operators stop getting stuck on stale code, and a round of UI polish.

### Fixed

- **node-agent no longer stalls during a core restart.** Adapter mutexes were
  held across the multi-second subprocess restart (xray / shadowsocks / mtproto /
  mieru / naive), blocking `/healthz` and the panel's push workers, plus a data
  race on the Hysteria auth-callback. Locks are split so restarts run lock-free.
- **deploy/update no longer silently rebuilds stale code.** `deploy*.sh` ran
  `git pull --ff-only`, a no-op on the tag-pinned detached HEAD the installer
  leaves behind, so re-deploys quietly rebuilt the old version. They now sync to
  `ICESLAB_REF` (branch or tag), fetch all refs, and fail loudly on an ambiguous
  detached HEAD. The installer is a full clone so updates stay reachable.
- **deploy applies new migrations.** Migrations ran against the previous image
  before the rebuild, so a deploy that added a migration silently skipped it.
  Reordered to build, then migrate, then start.
- **multi-profile deploy to a fresh node.** Deploying several profiles to a new
  node assigned port 443 to every one, so all but the first failed with
  PORT_IN_USE. Each profile now gets a distinct port.
- **"Top users today" dashboard card** was always empty (the table it reads was
  never written); the stats poll now records per-user daily usage.
- Subscription endpoint name de-dup, inline port-edit collision check, bounded
  AmneziaWG IP allocation, and other audit fixes.

### Changed

- **Protocol dropdown** lists Xray first with a disabled "sing-box (soon)" teaser
  everywhere a protocol is chosen.
- **UI polish.** The Users status chips are now the single filter (dropped a
  duplicate control); node cards show the node address; filter chips are
  keyboard-operable.
- **Build resilience.** `prisma generate` retries on a flaky network during the
  Docker build, and the Prisma update-check call is disabled.

## v0.1.3

Subscription self-service for end users, plus a dashboard CPU-reporting fix
and an ops-script papercut.

### Added

- **Human-readable subscription page.** Opening `/sub/<token>` in a browser
  used to dump raw base64 ([#1](https://github.com/icecompany-tech/iceslab/issues/1)).
  It now serves a self-contained landing page: status (traffic / expiry /
  protocols), a copy-able subscription link, deep-link import buttons
  (Hiddify / Streisand / v2rayNG / Clash), and per-format download buttons
  including the AmneziaWG `.conf`. RU/EN by Accept-Language. VPN clients are
  unaffected (an explicit `?format=` always wins).
- **QR codes on the subscription page.** One QR for the subscription URL
  (scan to import in proxy clients) and, when an AmneziaWG endpoint exists, a
  QR of the wg-quick config text (scan straight into AmneziaVPN). Generated
  server-side as inline SVG via `qrcode-svg` (zero external requests).

### Fixed

- **Dashboard CPU headline.** The host CPU card showed a 200ms instantaneous
  sample taken while the backend builds the overview, so a 1-vCPU host saw
  its own work as an 80%+ spike. The headline now uses the 1-minute
  load-average percentage (sustained busy-ness); the sample stays as
  secondary detail.
- **Ops scripts run from anywhere.** `deploy.sh` / `restore.sh` / etc. errored
  when run from `scripts/` instead of the project root. They now auto-resolve
  the root, so `cd scripts && ./deploy.sh` works too.

### Performance

- **Dashboard overview cache TTL 8s → 30s.** At 8s the cache expired before
  almost every poll, so the ~20-query recompute ran every ~10s and pegged
  small hosts. Now throttled to at most twice a minute regardless of tab count.

## v0.1.2

Stabilization release: security hardening across the node-agent and installers,
a batch of panel performance fixes, and completion of the per-protocol port
wiring so port changes from the UI take effect on every core.

### Security

- **node-agent: config-injection guards.** AmneziaWG renders peer keys / AllowedIPs
  into the awg-quick INI and Hysteria renders obfs password / masquerade URL into
  YAML. Both now whitelist input (base64 WG keys, CIDR, no YAML metacharacters) so
  a hostile or buggy panel push can't break out of the config and inject
  `PostUp=` / top-level directives that run as root.
- **node-agent: constant-time panel-cert fingerprint compare**, mtproto Secret
  hex validation, Shadowsocks config now written via the atomic fsync helper
  (was a non-durable WriteFile+rename).
- **panel-auth: per-(IP, username) login lockout.** Username-only lockout let any
  bot lock out the real admin from a different IP; confirmed live during a
  distributed brute-force. Lockout state is now keyed on the source IP too.
- **panel-auth:** `cookie.secure` driven by `NODE_ENV`, admin usernames redacted
  in Telegram login alerts.
- **panel-backend: per-route auth.** Plugin-level `addHook` auth replaced with
  per-route `onRequest` across 9 route plugins so a future public route can't
  silently inherit no-auth (Fastify v5 quirk).
- **installer: supply-chain + token-leak hardening.** `--bootstrap-file` keeps
  the bootstrap token out of `/proc/cmdline`; optional `ICESLAB_REF_SHA` pins the
  expected commit so a re-pointed tag aborts the install. `fail2ban` jails for
  auth brute-force + probe scanners in domain mode.

### Fixed

- **installer pinned to v0.1.0.** Default `ICESLAB_REF` / `ICESLAB_NODE_REF` were
  still `v0.1.0`, so fresh installs pulled stale code with bugs already fixed in
  later releases. Now pinned to `v0.1.2`. ([#1](https://github.com/icecompany-tech/iceslab/issues/1))
- **per-protocol port wiring.** `ApplyInbound` now receives the panel binding
  port and every adapter (hysteria, amneziawg, xray, naive, shadowsocks, mtproto,
  mieru) rebinds to it. Previously the port was install-time only and UI port
  changes were silently dropped.
- **node-agent default port 8443 → 1337.** 8443 is the first port every scanner
  probes after 443; 1337 stays out of standard scanner profiles and frees 8443
  for a normal user-protocol binding. Existing nodes keep their pinned port.
- **quick-deploy picks the first free port** from `[443, 8443, 2053, 2083, 2087,
  2096]` instead of hardcoding 443 (which 409'd on any second binding). The UI
  flags a collision with the node-agent's own mTLS port.
- **node-agent fanout is best-effort.** A dormant/not-yet-Healthy adapter failing
  during addUser/removeUser no longer 500s the whole request (was breaking
  first-time backfill on fresh nodes).
- **heartbeat trusts system CAs + panel CA** so an LE-fronted public panel stops
  logging `certificate signed by unknown authority` on every heartbeat.
- **cron clears stale `lastStatusMessage`** when a node recovers from `degraded`
  (the old guard never re-wrote when the new message was empty).
- **MTProto tg:// URI** no longer carries a `#fragment` that strict Telegram
  parsers rejected.

### Performance

- **AWG IP allocation in one SQL round-trip** (was 3 queries + a 254-candidate
  JS scan per user).
- **inbounds-sync batches addUser** in bounded-parallel chunks instead of N
  serial mTLS round-trips.
- **UsersPage server-side pagination** + debounced search (was fetching up to 500
  users and paging in JS, silently truncating larger installs).
- **AppLayout reads sidebar counts from the dashboard cache** - one request
  instead of four full-list queries on every page transition.
- **removeUser cron enqueues deduped by jobId** (a stable orphan was re-enqueued
  ~144×/day).
- **dropped a redundant 10s dashboard poll** inside the node edit modal.

### Docs

- README: "Running multiple protocols on one node" section and an installer
  env-var table (`ICESLAB_REF`, `SKIP_SWAP`, `NODE_PORT`, `FRONTEND_PORT`).
  Russian README kept in parity.

## v0.1.1

First post-publication stabilization pass: docker-compose healthcheck path fix
(the first-install blocker), pnpm-install OOM mitigation on 2 GB VPS, dashboard
heap-percentage fix, login-lockout default relaxation, Subscription sidebar
section, and assorted i18n cleanup.

## v0.1.0

Initial public release: multi-core proxy operator panel (Hysteria 2 / Xray
REALITY / AmneziaWG / NaiveProxy / Shadowsocks 2022 / MTProto / Mieru) with
TypeScript Fastify backend, React Mantine SPA, and a Go node-agent over mTLS.
