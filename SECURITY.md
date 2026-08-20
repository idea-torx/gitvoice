# Security policy

## Supported versions

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |

Security fixes land on `main` and are deployed from there. Forks should track `main` or cherry-pick.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Instead:

1. Email the maintainers via the address listed on [https://github.com/idea-torx](https://github.com/idea-torx) or open a **private** GitHub Security Advisory on this repo (Security → Advisories → New draft advisory).
2. Include: affected endpoint / flow, reproduction steps, impact assessment, and any suggested mitigation.

We aim to acknowledge within 72 hours and to ship or coordinate a fix within 14 days where feasible.

## What to know about this app's threat model

- Admin auth is gated by `ADMIN_TOKEN` + PBKDF2-hashed admin password + HMAC-signed 30-day tokens (rate-limited). Portal passwords are PBKDF2-hashed; client tokens are 7-day HMAC, client-scoped, and verified on every portal request.
- Secrets (`ADMIN_TOKEN`, `PORTAL_SECRET`, `GITHUB_TOKEN`, `OPENAI_API_KEY`) are injected via `wrangler secret put` in production and via gitignored `.dev.vars` locally. `wrangler.local.jsonc` intentionally carries only non-secret identifiers.
- If you run your own instance, rotate `ADMIN_TOKEN` and `PORTAL_SECRET` independently and treat the one-time **recovery code** as a credential.

## Disclosure guidance

Please give us a reasonable window to fix before public disclosure, and avoid accessing other tenants' data on the hosted instance (`invoicer-pro.ideatorx.workers.dev`) beyond what is necessary to demonstrate the issue.
