# What Iceslab stores about a user

Iceslab runs on servers you own: the panel and every node are yours, and so is
everything below. Iceslab sends none of it to us or to anyone else; what leaves
your servers is only what you set up to send, such as Telegram notifications
and webhooks. This page lists what the
panel and the nodes keep about the people you serve, for how long, and what you
can remove. It describes Iceslab v0.3.0. Earlier versions kept more; the last
section says what they may have left behind and how to clear it.

## In the panel database

| What | Kept for |
|---|---|
| **The user**: username, status, expiry, traffic limit, the subscription token, the generated connection credentials (Xray UUID, Hysteria and Naive passwords, AmneziaWG key pair), enabled protocols, device limit, routing choice, and what you typed in (description, tag, Telegram ID, email). Imported users also keep the ID they had in the source panel. | While the user exists. A deleted user is erased for good **30 days** after deletion, together with every row below that belongs to them. |
| **Traffic totals**: bytes used and lifetime, when the user was last online, first connected, the last node they used, the last reset. | While the user exists. |
| **Traffic per node and day**: bytes in and out. | **180 days**. |
| **Per-node counters** the statistics read (cumulative bytes per node, protocol and core). | While the user exists. |
| **Devices**: the device ID the client app sends (`x-hwid` header), first and last seen, an optional label. | Forgotten **90 days** after the device was last seen; a forgotten device no longer counts towards the device limit. |
| **AmneziaWG tunnel address** of the user on each AmneziaWG profile. | While the user exists. |
| **Subscription requests**: time, the client's IP address and User-Agent of every subscription fetch. The panel uses them for the per-user request history and for "has this subscriber fetched since the change". | **90 days**. |
| **Subscription events**: what an admin changed on the user (limits, expiry, status, before and after) and which admin. | **180 days**. |
| **Erased imports**: for a user who was imported and later erased, the SHA-256 of their source-panel ID and the erase time, so the next import from that source does not bring them back. No name, token or other data. | Indefinitely. |

The cleanup runs once a day.

**Backups.** A backup made with `./scripts/ops/iceslab.sh backup` (or
`scripts/ops/iceslab-backup.sh`) holds the database as it was at that moment:
a user erased since is still in every older archive, until that archive is
removed. The archive also holds the panel's secrets (a copy of
`.env.production`: the JWT secret, the database password, the node
certificate authority), so keep it as you keep those: off public storage,
readable only by you.

## In the panel's logs

- **Backend log.** A request whose path carries a token (a subscription, a node
  bootstrap) is logged with the token replaced by a mask, and the requester's
  address cut to its /24 (IPv4) or /48 (IPv6).
- **Frontend (nginx) log.** The same paths are logged with `<token>` in place of
  the token, the address cut to its /24, and the forwarded client address left
  out. Other requests (the admin panel) are logged in full.
- **Container logs** are capped at 10 MB x 3 files per container.
- **Host Caddy** (installs with a domain): `/var/log/caddy/access.log` keeps
  admin-panel requests in full, because fail2ban reads it to ban brute-force
  logins and scanners (Caddy's own rotation: 100 MB per file, 10 files, 90
  days). Subscription and bootstrap requests go to
  `/var/log/caddy/access-masked.log` instead, with the token masked and the
  address cut to /24 or /48 (10 MB per file, 5 files, 7 days). Caddy's error
  log, which goes to the system journal, is masked the same way.

## On the nodes

- **On disk**: each core's configuration holds the credentials, and for some
  cores the username, of the users that node serves (under `/etc/xray`,
  `/etc/sing-box`, `/etc/caddy`, `/etc/mita`, `/etc/amnezia/amneziawg`, and the
  agent's own `/etc/iceslab-node`); AmneziaWG also keeps each user's public key
  and tunnel address there. A user removed from the node is removed from these
  files on the next push.
- **In the journal**: no line per connection. Xray's access log is off,
  Hysteria runs at `warn`, NaiveProxy leaves the proxy's error lines (which
  named the client and the destination) out. MTProto (mtg) still logs the
  client's IP when a connection fails; it has no quieter level.
- **Traffic counters** are kept in memory and read by the panel; the node keeps
  no history of them.

## What earlier versions may have left

Versions before v0.3.0 kept more, and it stays on your servers until you
remove it:

- **Node journals**: a line per connection (the client's IP, and for Xray the
  destination and the user). The node page shows whether a node still has
  such lines and can clear them. journald and syslog cannot be cleared line by
  line, so this removes the node's whole journal and syslog. By hand, as root:
  `journalctl --rotate && journalctl --vacuum-time=1s` and
  `truncate -c -s 0 /var/log/syslog && rm -f /var/log/syslog.*`.
- **Panel logs**: every subscription fetch with the full token and the
  subscriber's IP, in the backend log, the frontend log and the host Caddy's
  `access.log`. Updating recreates the panel's containers, which removes their
  old logs. Clear the host Caddy's log as root:
  `truncate -s 0 /var/log/caddy/access.log && rm -f /var/log/caddy/access-*.log`.
  If those logs may have left your hands, reissue the subscription links of
  the users concerned.
- **Deleted users and old devices**: before v0.3.0 a deleted user stayed in
  the database for good, and devices were never forgotten. The first daily
  cleanup after the update erases every user deleted more than 30 days before
  it and every device unseen for 90 days.
