# Security Policy

## Reporting a vulnerability

If you've found a vulnerability in Iceslab, please don't open a public issue. Instead:

- Open a private advisory at https://github.com/icecompany-tech/iceslab/security/advisories/new
- Or email security@icecompany.tech

Include:

- The component affected (panel-backend, node-agent, install scripts, etc.)
- A minimal reproduction
- The impact you observed
- Your suggested fix if you have one

Expect an initial reply within a few days.

## What's in scope

- Authentication and authorization bypass on the panel
- Privilege escalation between users or admins
- mTLS / cert issuance flaws between panel and node
- Remote code execution on the node-agent via the panel→node API
- Subscription token leakage or guessability
- SSRF, command injection, path traversal in either component
- Vulnerabilities in `install-iceslab.sh` or `install-iceslab-node.sh` that could lead to root compromise

## What's out of scope

- DoS via traffic floods (proxies are inherently exposed to abuse)
- Issues in upstream binaries (Hysteria, Xray, AmneziaWG, Caddy, mtg, mieru, mita) - please report those to the respective upstream projects
- Operator misconfiguration (e.g. running with a weak admin password)
- Findings that require physical access to the panel VPS

## Supported versions

Only the latest tagged release receives security fixes. Pre-1.0 means the API and config formats may change between minor versions; track the changelog when upgrading.
