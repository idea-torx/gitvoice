# Gitvoice agent CLI

One file. Zero dependencies. Drives Gitvoice from any agent — Claude Code, Codex, OpenCode,
Hermes, or your own terminal.

```bash
curl -fsSL https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py -o gitvoice-agent.py
export GITVOICE_ADMIN_TOKEN="your-admin-token"   # or store in macOS Keychain (service=gitvoice-admin)
python3 gitvoice-agent.py --help
```

## What an agent can do

Every HTTP surface the worker exposes has a command here — the only exception is the Stripe
webhook, which Stripe calls, not an agent. A test in `test/core.test.ts` fails CI if a new route
ships without one.

| Command | Action |
|---|---|
| `status` | Onboarding/health probe — no auth needed |
| `setup` | First-time onboarding (admin password, business profile) → one-time recovery code |
| `auth` / `reset-password` / `recover` | Mint a token, rotate the admin password, or recover with the code |
| `settings` / `settings-update` | Provider profile, tax ID, logo URL, invoice theme |
| `operators` / `operator-add` | List operators; mint one (its token is shown once) |
| `clients` / `client-add` / `client-update` / `client-delete` | Full client profile CRUD, incl. portal passwords |
| `discover` / `bulk-import` | Find clients from GitHub activity; import many at once |
| `time` / `time-import` | Read or load a client's time entries |
| `preview` / `create` | Generate LLM-written invoice drafts; finalize (idempotent per billing period) |
| `get` / `list` / `versions` / `invoice-delete` | Inspect (`--html` for the rendered invoice), list, diff versions, remove |
| `summary-patch` | Rewrite an issued invoice's summary — bumps the version, keeps history |
| `void` / `reissue` / `notify` | Void, reissue, or email an invoice to the client |
| `pdf` | Download the invoice PDF |
| `backup` / `watch` | JSON snapshot + every invoice PDF, with manifest; on a timer |
| `portal-clients` / `portal-login` / `portal-invoices` | Authenticate as a client and view their archive |
| `portal-invoice` / `portal-dispute` | The client's own view of one invoice; file a dispute on it |

`client-add` / `client-update` cover the whole profile: `--name` (the company billed on the
invoice), `--first-name` / `--last-name` (the person addressed at it), `--email`, `--phone`,
`--address`, `--website`, `--currency`, `--payment-method etransfer|wire|alternative`,
`--model hourly|flat`, `--rate-cents`. Unset flags on `client-update` leave the stored value alone.

`preview` / `create` take `--desc` for a manual work description; **omit it** and the worker
summarizes the client's GitHub activity instead. Either way `--title`, `--overview`,
`--highlight`, `--deliverable`, `--next-step` (repeatable) and `--summary-file` override what
the model wrote, before the invoice is finalized.

## Auth

The CLI mints a 30-day admin token via `POST /api/auth` using your admin secret, then caches it
(`~/.hermes/state/gitvoice-token.json`, `0600`). Provide the secret with:

- `GITVOICE_ADMIN_TOKEN` env var (any platform), or
- macOS Keychain: `security add-generic-password -U -a leofelix -s gitvoice-admin -w 'YOUR_TOKEN'`

Point `--base` at any Gitvoice deployment (default: the hosted worker).

## Safety

- `create`, `client-delete`, `invoice-delete`, `notify`, and `portal-dispute` require an explicit
  `--yes` — the two that reach the client (an email, a dispute) included.
- Re-running `create` for an already-invoiced period returns the existing invoice — no duplicates.
- Tokens and secrets are never printed.
