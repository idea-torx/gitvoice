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
- Do not commit secrets or per-instance Cloudflare identifiers. Use `.dev.vars` and the gitignored `wrangler.local.jsonc` overlay for your own deployment.
- Add or update tests in `test/` for behavior changes.
- Follow the existing TypeScript style (strict, no implicit any).
