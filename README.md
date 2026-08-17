# Gitvoice

Gitvoice turns a client's GitHub activity into a clear, multi-page invoice. It ships as a Cloudflare Worker with a private admin workspace and a simple password-protected client portal.

**Open source. Agent-ready.** The whole product — worker, portal, and a zero-dependency agent CLI — lives in this repo, and any AI agent can run it end-to-end:

```bash
curl -fsSL https://invoicer-pro.ideatorx.workers.dev/agent-cli/gitvoice-agent.py -o gitvoice-agent.py
export GITVOICE_ADMIN_TOKEN="your-admin-token"
python3 gitvoice-agent.py --help
```

Create clients (with portal passwords), generate LLM-written invoices, download PDFs, run backups, and onboard the whole workspace — from Claude Code, Codex, OpenCode, Hermes, or a plain terminal. See [`agent-cli/README.md`](public/agent-cli/README.md) for the full surface.

## Live deployment and handoff

- **Product workspace:** https://invoicer-pro.ideatorx.workers.dev/
- **Custom domain:** `https://gitvoice.dev` (DNS/custom-domain binding is managed separately from this repository)
- **Public source:** https://github.com/idea-torx/gitvoice
- **Marketing site source:** https://github.com/idea-torx/gitvoice-site

The public repository is the source of truth for the open-source product. Production secrets, D1/R2 resource credentials, and admin tokens must remain outside git. The tracked `wrangler.local.jsonc` contains the maintainer's resource identifiers and deployment variables; secrets are supplied through Cloudflare and local environment files.

## What it does

- Pulls commits from one or more GitHub repositories for a chosen week, month, or custom date range.
- Produces an outcome-ranked work overview, activity summary, highlights, timeline, and detailed activity log from commits, merged pull requests, and releases.
- Stores optional project context and milestone priorities per client so summaries understand the larger project story.
- Supports flat-fee and hourly clients. The roster stores the billing model; the exact fee, or hourly rate and billable hours, is required when each invoice is created.
- Stores each client's preferred payment method—E-transfer, wire transfer, or an alternative—and prints it on the invoice.
- Stores client profiles, provider settings, invoice records, pricing snapshots, and activity snapshots in Cloudflare D1.
- Stores production PDFs in R2 and renders them with Cloudflare Browser Rendering.
- Gives each client one assigned portal password for viewing only their own invoices—no account or login system required.
- Hashes portal passwords with PBKDF2 and issues signed, seven-day client-scoped access tokens.
- Lets each operator set their own business name, provider details, and logo, which appear on invoices and the client portal.

## Local setup

Install dependencies, apply the D1 migrations, and start the Worker:

```bash
npm install
npx wrangler d1 migrations apply gitvoice --local
npm run dev
```

`npm run dev` auto-creates `.dev.vars` with a fresh `ADMIN_TOKEN` and `PORTAL_SECRET` if it's missing, so local setup is zero-config. You can also copy `.dev.vars.example` to `.dev.vars` and fill in your own values:

```dotenv
ADMIN_TOKEN="choose-a-private-admin-token"
PORTAL_SECRET="choose-a-separate-signing-secret"
GITHUB_TOKEN="optional-for-public-repos"
OPENAI_API_KEY="optional-alternative-provider"
```

Open the admin workspace at `http://localhost:8787` and the client portal at `http://localhost:8787/portal`. On first run locally you'll be walked through setup (create an admin password, add your business details, and your first client) — no token required on `localhost`.

The GitHub token is optional for public repositories, but strongly recommended to avoid anonymous API rate limits. Cloudflare Workers AI is the default summarizer and needs no additional secret. An OpenAI key remains an optional alternative; if AI is unavailable, the Worker uses an outcome-ranked deterministic fallback.

Local invoice HTML works without Cloudflare Browser Rendering. Production PDF creation requires the configured Browser Rendering and R2 bindings.

## First-run setup and admin login

Gitvoice has a small bootstrap-then-self-serve auth model:

1. **Local dev** — open `http://localhost:8787` and click **Get started**. No token is needed on `localhost`.
2. **Production** — open your Worker URL, enter the `ADMIN_TOKEN` secret as the *setup token*, then complete setup.
3. Setup asks you to choose an **admin password**, add your **business details** (name, provider info, logo), and optionally a **first client**.
4. At the end you're shown a **one-time recovery code** — save it. It's the only way to reset your password.

After setup, you sign in with your admin password. The `ADMIN_TOKEN` remains a working root credential and can be rotated via `wrangler secret put ADMIN_TOKEN`. To reset a forgotten password, click **Lost access? Use your recovery code** on the sign-in screen and enter your saved code plus a new password.

## Cloudflare deployment

1. Create the D1 database and paste its id into `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create gitvoice
   ```

2. Set your account id in `wrangler.jsonc` (or export `CLOUDFLARE_ACCOUNT_ID`).
3. Create the R2 bucket:

   ```bash
   npx wrangler r2 bucket create gitvoice-pdfs
   ```

4. Apply migrations and configure secrets:

   ```bash
   npx wrangler d1 migrations apply gitvoice --remote
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put PORTAL_SECRET
   npx wrangler secret put GITHUB_TOKEN
   ```

5. Set `APP_ORIGIN` in `wrangler.jsonc` to your deployed Worker URL, then deploy:

   ```bash
   npx wrangler deploy
   ```

## Running your own instance alongside the repo

`wrangler.jsonc` is the generic, shareable configuration. `wrangler.local.jsonc` is a tracked overlay for a specific instance (this repo carries the maintainer's as a working example — resource identifiers only, no secrets; those stay in the gitignored `.dev.vars`):

1. Edit `wrangler.local.jsonc` (or copy `wrangler.jsonc` over it) and fill in your own `account_id`, `database_id`, `bucket_name`, and `APP_ORIGIN`.
2. Develop and deploy against it with:

   ```bash
   npm run dev:local
   npx wrangler deploy --config wrangler.local.jsonc
   ```

Your data stays put—rebranding is a settings concern, not a schema change. Edit your provider's name and logo in the admin workspace under **Manage settings**; no migration is required.

## Client portal flow

1. Open a client in the admin roster.
2. Assign a client portal password and save.
3. Share the portal URL and password privately.
4. The client chooses their company, enters the password, and sees only invoices belonging to that client.

Leaving the password field blank during a later edit preserves the current password.

## Cost controls

- Summary evidence is clustered inside the Worker and sent through one Workers AI request per preview.
- Generating an invoice reuses its reviewed preview instead of repeating GitHub collection and AI summarization.
- Repeated preview clicks with unchanged inputs reuse the current result.
- Each PDF is rendered once, stored in R2, and served from storage on later views and downloads.
- D1 stores only structured records; PDFs remain in R2.

## Verification

```bash
npm run typecheck
npm test
npm run render:sample
```

`npm run render:sample` writes `output/sample-invoice.html`. The admin API is protected by `ADMIN_TOKEN` and signed admin session tokens; portal routes enforce their own client-scoped signed token.

## License

See [LICENSE](./LICENSE). Contributions are welcome—see [CONTRIBUTING.md](./CONTRIBUTING.md).
