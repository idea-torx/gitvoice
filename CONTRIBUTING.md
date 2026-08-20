# Contributing to Gitvoice

Thanks for your interest! This is an open-source Cloudflare Worker + D1/R2 + Workers AI product. PRs that make invoices clearer, invoices cheaper, or the agent surface more complete are especially welcome.

## Quick start

```bash
git clone https://github.com/idea-torx/gitvoice.git
cd gitvoice
npm install
npx wrangler d1 migrations apply gitvoice --local
npm run dev   # → http://localhost:8787  (admin)  and  http://localhost:8787/portal
```

`npm run dev` auto-creates `.dev.vars` on first run. For manual secrets, copy `.dev.vars.example` → `.dev.vars` and fill in `ADMIN_TOKEN`, `PORTAL_SECRET`, `GITHUB_TOKEN`, etc. On `localhost`, first-run setup needs no token.

## Checks before a PR

```bash
npm run typecheck
npm test
npm run render:sample   # writes output/sample-invoice.html — open it in a browser
```

CI runs `typecheck` + `test` on every push / PR to `main`. The deploy workflow publishes only from `main` after those checks.

## Ground rules

- **Keep the Worker self-contained.** Structured records → D1, PDFs → R2, render → Browser Rendering. Don't add external persistence.
- **Never commit secrets.** Tokens and passwords belong in gitignored `.dev.vars` (local) or `wrangler secret put` (prod). `wrangler.jsonc` is generic; `wrangler.local.jsonc` is the maintainer's overlay (resource ids only, no secrets). Leave the overlay out of PRs unless the PR is about the overlay itself.
- **Types matter.** The project is strict TypeScript (`noImplicitAny`, etc.). Match the existing style; run `typecheck` before requesting review.
- **Tests travel with behavior changes.** Add or update `test/core.test.ts` (or new files under `test/`) for any change to routing, auth, GitHub collection, summaries, or repository logic.
- **Summaries stay honest.** The LLM path must not invent hours, metrics, adoption, or business impact. Deterministic fallback must rank outcomes (launches > fixes > chores). See `src/summary.ts`.
- **Small, focused PRs.** One concern per PR; include a clear description and `Fixes #…` when applicable.

## Reporting bugs / requesting features

Open an issue with: steps to reproduce, expected vs actual behavior, and the billing period / `wrangler dev` log tail if relevant. For security issues, see [SECURITY.md](./SECURITY.md) — don't open a public issue.

## Code of conduct

This project follows [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). By participating, you agree to its terms.

## License

By contributing, you agree your contributions are licensed under the repository's [MIT License](./LICENSE).
