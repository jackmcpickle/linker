# habits-linker

Password-protected admin to mint expiring share links for R2 folders.

- **Domain:** `linker.habitsofmind.com.au`
- **Admin:** `linker.habitsofmind.com.au/_admin`
- **Shares:** `<token>.linker.habitsofmind.com.au/...`

See [`docs/PLAN.md`](docs/PLAN.md) for design, [`SETUP.md`](SETUP.md) for
one-time CF setup, [`progress.md`](progress.md) for build status.

## Dev

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in secrets
pnpm tailwind                     # build public/style.css
pnpm dev                          # wrangler dev --remote + tailwind watch
```

## Deploy

```bash
pnpm deploy
```
