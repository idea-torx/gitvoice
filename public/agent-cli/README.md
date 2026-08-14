# Gitvoice agent CLI

One file. Zero dependencies. Drives Gitvoice from any agent — Claude Code, Codex, OpenCode,
Hermes, or your own terminal.

```bash
curl -fsSL https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py -o gitvoice-agent.py
export GITVOICE_ADMIN_TOKEN="your-admin-token"   # or store in macOS Keychain (service=gitvoice-admin)
python3 gitvoice-agent.py --help
```

## What an agent can do

| Command | Action |
|---|---|
| `setup` | First-time onboarding (admin password, business profile) → one-time recovery code |
| `clients` / `client-add` / `client-update` / `client-delete` | Full client profile CRUD, incl. portal passwords |
| `preview` / `create` | Generate LLM-written invoice drafts; finalize (idempotent per billing period) |
| `get` / `list` / `invoice-delete` | Inspect, list, or remove invoices |
| `pdf` | Download the invoice PDF |
| `backup` | JSON snapshot + every invoice PDF, with manifest |
| `settings` / `settings-update` | Provider profile, tax ID, logo URL |
| `portal-login` / `portal-invoices` | Authenticate as a client and view their portal archive |

## Auth

The CLI mints a 30-day admin token via `POST /api/auth` using your admin secret, then caches it
(`~/.hermes/state/gitvoice-token.json`, `0600`). Provide the secret with:

- `GITVOICE_ADMIN_TOKEN` env var (any platform), or
- macOS Keychain: `security add-generic-password -U -a leofelix -s gitvoice-admin -w 'YOUR_TOKEN'`

Point `--base` at any Gitvoice deployment (default: the hosted worker).

## Safety

- `create`, `client-delete`, and `invoice-delete` require an explicit `--yes`.
- Re-running `create` for an already-invoiced period returns the existing invoice — no duplicates.
- Tokens and secrets are never printed.
