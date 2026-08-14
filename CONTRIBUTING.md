# Contributing

Thanks for your interest in Gitvoice. Contributions are welcome.

## Development

```bash
npm install
npx wrangler d1 migrations apply gitvoice --local
npm run dev
```

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npm test
npm run render:sample
```

## Guidelines

- Keep the Worker self-contained: D1 stores structured records, PDFs live in R2.
- Do not commit secrets. Use the gitignored `.dev.vars` for tokens and passwords. `wrangler.local.jsonc` is the maintainer's instance overlay (non-secret resource identifiers); leave it out of pull requests unless your change is about the overlay itself.
- Add or update tests in `test/` for behavior changes.
- Follow the existing TypeScript style (strict, no implicit any).
