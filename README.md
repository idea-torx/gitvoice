# Gitvoice

> Turn a client's GitHub activity into a clear, polished, multi-page invoice — on Cloudflare Workers.

[![CI](https://github.com/idea-torx/gitvoice/actions/workflows/ci.yml/badge.svg)](https://github.com/idea-torx/gitvoice/actions/workflows/ci.yml)
[![Deploy](https://github.com/idea-torx/gitvoice/actions/workflows/deploy.yml/badge.svg)](https://github.com/idea-torx/gitvoice/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-0a0a0a.svg)](#)

**Open source. Agent-ready.** The whole product — Worker, admin workspace, password-protected client portal, and a zero-dependency agent CLI — lives in this repo. Any agent (or human) can run it end-to-end:

```bash
curl -fsSL https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py -o gitvoice-agent.py
export GITVOICE_ADMIN_TOKEN="your-admin-token"
python3 gitvoice-agent.py --help
```

See [`public/agent-cli/README.md`](public/agent-cli/README.md) for the full CLI surface.

---

## Table of contents

- [Live links](#live-links)
- [What it does](#what-it-does)
- [Tech stack & architecture](#tech-stack--architecture)
- [Quick start — local setup](#quick-start--local-setup)
- [Environment variables](#environment-variables)
- [First-run setup & auth](#first-run-setup--auth)
- [Cloudflare deployment](#cloudflare-deployment)
- [Running your own instance (overlay)](#running-your-own-instance-overlay)
- [Client portal flow](#client-portal-flow)
- [Agent CLI](#agent-cli)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Cost controls](#cost-controls)
- [Security](#security)
- [Verification & tests](#verification--tests)
- [Customization & branding](#customization--branding)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Live links

| Surface | URL |
|---|---|
| **Product workspace (admin)** | https://invoicer-pro.ideatorx.workers.dev/ |
| **Custom domain** | https://gitvoice.dev _(DNS / custom-domain binding managed outside this repo)_ |
| **Client portal** | https://invoicer-pro.ideatorx.workers.dev/portal |
| **Agent CLI** | https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py |
| **Marketing site source** | https://github.com/idea-torx/gitvoice-site |
| **This repo** | https://github.com/idea-torx/gitvoice |

The public repository is the **source of truth** for the open-source product. Production secrets, D1/R2 credentials, and admin tokens must never be committed. `wrangler.jsonc` is the generic shareable config; `wrangler.local.jsonc` is a tracked overlay with the maintainer's non-secret resource identifiers — see [Running your own instance](#running-your-own-instance-overlay).

---

## What it does

| Capability | Detail |
|---|---|
| **GitHub → invoice** | Pulls commits from one or more repos for any week / month / custom range, via GraphQL (with token) or REST (without). |
| **Outcome-ranked summaries** | Outcome-first work overview, activity summary, highlights, timeline, and detailed log from commits + merged PRs + releases. |
| **LLM + deterministic fallback** | Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) by default; optional OpenAI; deterministic ranking when no model is available. |
| **Project-aware** | Per-client `projectContext` and `summaryPriorities` so the model understands milestones and what to emphasize. |
| **Flat-fee & hourly** | Roster stores the billing model; the exact fee _or_ rate + hours is required on every invoice creation. |
| **Payment preference on paper** | `E-transfer` / `Wire` / `Alternative` stored per client and printed on the invoice. |
| **D1 + R2 + Browser Rendering** | Clients, provider, invoices, pricing & activity snapshots in **D1**; PDFs in **R2**; production PDFs via **Cloudflare Browser Rendering**. |
| **Single-password client portal** | One password per client → PBKDF2 hash → 7-day signed client-scoped token. No accounts. |
| **Own your brand** | Business name, provider details, and logo are operator-owned and appear on every invoice & in the portal. |
| **Manual invoices** | Describe work by hand when there's no repo trail — same polished summary path, `manualDescription` stored alongside. |
| **Idempotent by period** | Re-creating for an already-invoiced `(client, period)` returns the existing record — no duplicates. |

---

## Tech stack & architecture

```
Browser (admin SPA + portal)  ──►  Cloudflare Worker (src/index.ts)
                                      ├─► GitHub API  (GraphQL primary, REST fallback)
                                      ├─► Workers AI  ─┐
                                      ├─► OpenAI (optional) ──► Summary engine (src/summary.ts)
                                      ├─► D1 (clients, invoices, provider, disputes, counters)
                                      ├─► R2 (invoice PDFs)
                                      └─► Browser Rendering (PDF)
Agent CLI (public/agent-cli/gitvoice-agent.py, zero-deps Python)
```

| Layer | Choice |
|---|---|
| Runtime | **Cloudflare Workers**, `nodejs_compat` |
| Language | **TypeScript 5.8** (strict, `noImplicitAny`) |
| Storage | **Cloudflare D1** (SQLite) — structured records |
| Objects | **Cloudflare R2** — PDFs |
| AI | **Cloudflare Workers AI** default; **OpenAI Responses API** optional |
| Auth | `ADMIN_TOKEN` + PBKDF2-hashed admin password + signed JWT-style admin tokens; PBKDF2-hashed portal passwords + 7-day portal tokens |
| PDF | **Browser Rendering** (`binding: BROWSER`) — render once, store, serve |
| Frontend | Static assets in `public/` (`index.html`, `portal.html`, `app.js`) served via `ASSETS` with `run_worker_first: true` |
| Tests | **Vitest** (`test/core.test.ts`) |
| Deploy | **Wrangler 4** + `wrangler.jsonc` / `wrangler.local.jsonc` |

Key source files: `src/index.ts` (router + auth + invoice lifecycle), `src/github.ts` (collect + signals), `src/summary.ts` (evidence digest, ranking, LLM orchestration), `src/invoice.ts` (HTML render), `src/repository.ts` (D1 access), `src/security.ts` (hashing + tokens), `migrations/*.sql`.

---

## Quick start — local setup

**Prereqs:** Node 20+, `npm`, and a Cloudflare account for later deploys (not needed for local dev).

```bash
git clone https://github.com/idea-torx/gitvoice.git
cd gitvoice
npm install
npx wrangler d1 migrations apply gitvoice --local
npm run dev
```

`npm run dev` auto-creates `.dev.vars` with a fresh `ADMIN_TOKEN` + `PORTAL_SECRET` if missing — zero-config first run. Or copy the template yourself:

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars
```

Open:

- Admin workspace → http://localhost:8787
- Client portal → http://localhost:8787/portal

On `localhost` the first visit needs no token — click **Get started** and you are walked through admin password → business details → first client. Production is token-gated — see below.

> Local HTML invoices work without Browser Rendering. Production PDFs require the `BROWSER` + `R2` bindings.

---

## Environment variables

| Variable | Required | Where | Purpose |
|---|---|---|---|
| `ADMIN_TOKEN` | Yes (prod) | `wrangler secret put ADMIN_TOKEN` / `.dev.vars` local | Root setup / recovery credential; also fallback portal secret. Rotatable. |
| `PORTAL_SECRET` | Yes (prod) | `wrangler secret put PORTAL_SECRET` / `.dev.vars` | HMAC secret for client portal tokens. Use a _different_ value from `ADMIN_TOKEN` in production. |
| `GITHUB_TOKEN` | Recommended | secret / `.dev.vars` | Avoids anonymous rate limits; enables GraphQL path. Optional for public repos. |
| `OPENAI_API_KEY` | No | secret / `.dev.vars` | Optional alternative summarizer. When absent, Workers AI is used; when neither is available, deterministic fallback runs. |
| `OPENAI_MODEL` | No | `wrangler.jsonc` `vars` | Defaults to `gpt-5.6-luna` when `OPENAI_API_KEY` is set. |
| `APP_ORIGIN` | Yes (prod) | `wrangler.jsonc` `vars` | Canonical Worker URL (e.g. `https://your-worker.workers.dev`). Guards PDF rendering. |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy only | env / `wrangler.jsonc` | Your Cloudflare account id. |

Tracked file `wrangler.local.jsonc` holds the maintainer's non-secret identifiers (account id, D1 `database_id`, bucket name, `APP_ORIGIN`) — never put secrets there.

---

## First-run setup & auth

```
localhost:8787 ──► Get started (no token) ──► choose admin password
                                          ──► business profile (name, address, logo)
                                          ──► optional first client
                                          ──► one-time recovery code (save it!)

production ──► enter ADMIN_TOKEN as setup token ──► same flow ──► recovery code
```

Post-setup, sign in with your **admin password**. `ADMIN_TOKEN` stays a valid root credential (rotate via `wrangler secret put ADMIN_TOKEN`). Forgot your password → **Lost access? Use your recovery code** → recovery code + new password.

Tokens: admin sessions are 30-day signed tokens; client portal tokens are 7-day client-scoped tokens. Auth endpoints are rate-limited (10 attempts / 60 s per IP).

---

## Cloudflare deployment

```bash
# 1. Create D1 and paste its id into wrangler.jsonc
npx wrangler d1 create gitvoice

# 2. Set account_id in wrangler.jsonc or export CLOUDFLARE_ACCOUNT_ID
# 3. Create R2 bucket
npx wrangler r2 bucket create gitvoice-pdfs

# 4. Apply migrations + secrets (remote)
npx wrangler d1 migrations apply gitvoice --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put PORTAL_SECRET
npx wrangler secret put GITHUB_TOKEN   # optional but recommended

# 5. Set APP_ORIGIN in wrangler.jsonc to your deployed URL, then deploy
npx wrangler deploy
```

Cron `0 8 * * *` is configured in `wrangler.jsonc` for scheduled housekeeping — adjust or remove as needed.

---

## Running your own instance (overlay)

`wrangler.jsonc` is the generic config for forks; `wrangler.local.jsonc` is a **tracked overlay** for a concrete instance.

```bash
# fork path: copy generic over overlay and fill your identifiers
cp wrangler.jsonc wrangler.local.jsonc
# edit wrangler.local.jsonc: account_id, database_id, bucket_name, APP_ORIGIN

npm run dev:local
npx wrangler deploy --config wrangler.local.jsonc
# or, for the maintainer's prod instance:
npm run deploy:prod
```

Rebranding is a **settings** concern, not a schema change — edit provider name/logo under **Manage settings** in the admin UI.

---

## Client portal flow

1. Admin opens a client in the roster → sets a **portal password** → saves.
2. Admin shares the portal URL + password privately (outside the app).
3. Client opens `/portal`, picks their company, enters the password → sees **only their own invoices**.
4. Clients can open HTML or PDF for any invoice, and dispute an invoice with a reason.
5. Leaving the password blank on a later edit **preserves** the current password.

---

## Agent CLI

Zero dependencies, one file: [`public/agent-cli/gitvoice-agent.py`](public/agent-cli/gitvoice-agent.py) + [CLI docs](public/agent-cli/README.md).

```bash
# install
curl -fsSL https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py -o gitvoice-agent.py

# auth — env var or macOS Keychain (service=gitvoice-admin)
export GITVOICE_ADMIN_TOKEN="your-admin-token"
# or: security add-generic-password -U -a $USER -s gitvoice-admin -w 'YOUR_TOKEN'

python3 gitvoice-agent.py --help
python3 gitvoice-agent.py --base https://your-worker.workers.dev setup
python3 gitvoice-agent.py clients
python3 gitvoice-agent.py preview --client <id> --start 2026-03-01 --end 2026-03-31
python3 gitvoice-agent.py create  --client <id> --start 2026-03-01 --end 2026-03-31 --yes
python3 gitvoice-agent.py pdf --invoice <invoice-id> --out invoice.pdf
python3 gitvoice-agent.py backup --out ./backup
```

| Command | Action |
|---|---|
| `setup` | First-time onboarding → recovery code |
| `clients` / `client-add` / `client-update` / `client-delete` | Full client CRUD incl. portal passwords |
| `preview` / `create` | LLM-written drafts; finalize is idempotent per period |
| `get` / `list` / `invoice-delete` | Inspect / list / remove invoices |
| `pdf` | Download PDF (rendered once, stored in R2) |
| `backup` | JSON snapshot + every PDF + manifest |
| `settings` / `settings-update` | Provider profile |
| `portal-login` / `portal-invoices` | Exercise client portal as that client |

Safety: `create`, `client-delete`, `invoice-delete` require `--yes`; re-running `create` for the same period returns the existing invoice; secrets are never printed and tokens are cached `0600` at `~/.hermes/state/gitvoice-token.json`.

---

## API reference

All admin routes require `Authorization: Bearer <admin-token>` except `GET /api/status`, `GET /api/portal/*`, and portal invoice routes which use client tokens. Admin tokens are 30-day HMAC tokens minted via `POST /api/auth`.

### Admin

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | `{ ok, service: "gitvoice" }` |
| `GET` | `/api/status` | `{ onboarded, hasAdminPassword, local }` |
| `POST` | `/api/auth` | `{ password }` → `{ token, requiresSetup }` |
| `POST` | `/api/auth/recover` | `{ recoveryCode, password }` → `{ recoveryCode }` |
| `POST` | `/api/setup` | `{ password, provider? }` → `{ recoveryCode, provider, token }` — localhost or admin token required |
| `GET` | `/api/bootstrap` | `{ provider, clients, invoices }` — full admin snapshot |
| `PUT` | `/api/settings` | Upsert `ProviderProfile` |
| `POST` | `/api/clients` | Create client (`ClientInput`) |
| `PUT` | `/api/clients/:id` | Update client |
| `DELETE` | `/api/clients/:id` | Delete client |
| `POST` | `/api/preview` | `{ clientId, periodStart, periodEnd, pricing?, source?, description? }` → `{ invoice, html }` |
| `POST` | `/api/invoices` | Finalize invoice (idempotent) + kick PDF render → `{ invoice }` |
| `GET` | `/api/invoices` | `{ invoices }` |
| `GET` | `/api/invoices/:id` | Single invoice JSON |
| `DELETE` | `/api/invoices/:id` | Delete invoice (+ R2 object) |
| `GET` | `/api/invoices/:id/pdf` | PDF bytes (`application/pdf`) |
| `GET` | `/invoice/:id` | Invoice HTML |

### Client portal (client-scoped, 7-day token)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/portal/clients` | `{ clients: [{id,name}], provider: {businessName,logoUrl} }` |
| `POST` | `/api/portal/auth` | `{ clientId, password }` → `{ token, client }` |
| `GET` | `/api/portal/invoices?token=…` | `{ client, invoices }` (or `Authorization: Bearer <portal-token>`) |
| `GET` | `/portal/invoices/:id?token=…` | Invoice HTML (portal-scoped) |
| `GET` | `/portal/invoices/:id/pdf?token=…` | Invoice PDF (portal-scoped) |
| `POST` | `/portal/invoices/:id/dispute?token=…` | `{ reason }` → `{ dispute }` |

`InvoiceRequestBody` (`/api/preview`, `/api/invoices`): `clientId`, `periodStart`, `periodEnd` (ISO dates), optional `pricing: { model:"flat"|"hourly", amountCents?, rateCents?, hours?, description? }`, optional `source:"manual"` + `description` (operator-authored work description). When `preview.summary` + `preview.activity` is echoed back into `POST /api/invoices`, the Worker reuses it instead of re-collecting / re-summarizing.

---

## Project structure

```
.
├── src/
│   ├── index.ts        # router, auth, RBAC, invoice lifecycle, scheduled handler
│   ├── github.ts       # GraphQL/REST collection + PR/release signals
│   ├── summary.ts      # evidence digest, outcome ranking, Workers AI / OpenAI orchestration
│   ├── invoice.ts      # HTML → PDF-ready rendering
│   ├── repository.ts   # D1 helpers, migrations plumbing
│   ├── security.ts     # PBKDF2, HMAC tokens, recovery codes
│   └── types.ts        # Env, Client, Invoice, Activity, Summary types
├── public/
│   ├── index.html / app.js / styles.css   # admin SPA
│   ├── portal.html / portal.js / portal.css
│   └── agent-cli/gitvoice-agent.py + README.md
├── migrations/         # D1 migrations (0001_init … 0008_manual_description)
├── scripts/
│   ├── ensure-dev-vars.mjs   # zero-config .dev.vars bootstrap
│   └── render-sample.mjs     # writes output/sample-invoice.html
├── test/core.test.ts
├── wrangler.jsonc        # generic shareable config
├── wrangler.local.jsonc  # tracked overlay (maintainer instance)
└── package.json
```

---

## Cost controls

- One Workers AI request per **preview** (evidence is clustered first; digest capped at ~36k chars).
- Finalize **reuses** the reviewed preview — no second GitHub or AI call.
- Repeated preview clicks with unchanged inputs are coalesced.
- Each PDF is rendered **once**, stored in **R2**, served from storage on every later view/download.
- D1 holds only structured rows; PDFs never touch D1.

---

## Security

- Admin password and portal passwords hashed with **PBKDF2** (per-record salt). Tokens are **HMAC-signed** and stateless; admin 30 days, client-portal 7 days, client-scoped.
- Auth endpoints are **rate-limited** to 10 attempts / 60 s per IP.
- Secrets (`ADMIN_TOKEN`, `PORTAL_SECRET`, `GITHUB_TOKEN`, `OPENAI_API_KEY`) are supplied via `wrangler secret put` in production and via gitignored `.dev.vars` locally — **never commit them**. `wrangler.local.jsonc` carries only non-secret identifiers.
- A **recovery code** is issued once at setup; it is the only way to reset a lost admin password.
- Portal access is **client-isolated**: a portal token can only read invoices for its own `clientId`.
- See [SECURITY.md](./SECURITY.md) for disclosure instructions.

---

## Verification & tests

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run render:sample  # builds, writes output/sample-invoice.html — open it in a browser
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` on every push/PR to `main`. Deploy (`.github/workflows/deploy.yml`) pushes the maintainer's instance after tests.

---

## Customization & branding

- Provider name, business details, remittance text, tax id, website, and **logo URL** are managed in **Manage settings** — no migration, no fork needed.
- To run a white-label copy: keep `wrangler.jsonc` generic, put your identifiers in `wrangler.local.jsonc` (or your own overlay), and deploy. Your data stays in your D1/R2.

---

## Roadmap

- Per-client custom invoice templates & line-item editing
- Webhooks / scheduled auto-invoice for weekly/monthly cadence
- Branded PDF theming (fonts, accent, page chrome)
- Local PDF render parity (no Browser Rendering gap)
- Time-tracking integration as an alternate evidence source

PRs and issues are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Contributing

```bash
npm install
npx wrangler d1 migrations apply gitvoice --local
npm run dev
# then before PR:
npm run typecheck && npm test && npm run render:sample
```

Guidelines: keep the Worker self-contained, don't commit secrets, add/update tests in `test/` for behavior changes, follow the existing strict TypeScript style. Full guide: [`CONTRIBUTING.md`](CONTRIBUTING.md). Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

---

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 Gitvoice contributors.

Built with [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/), and [Workers AI](https://developers.cloudflare.com/workers-ai/).
