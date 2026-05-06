# Progress

Tracks implementation against [`docs/PLAN.md`](docs/PLAN.md).

| Stage | Title | Status |
|------:|-------|:------:|
| 1 | Scaffold | ⏳ |
| 2 | SETUP docs (CF resources) | ☐ |
| 3 | Worker dispatch (host-based routing) | ☐ |
| 4 | Admin auth | ☐ |
| 5 | Admin CRUD | ☐ |
| 6 | Typeahead prefix picker | ☐ |
| 7 | Share token gate + expiry page | ☐ |
| 8 | Share Turnstile interstitial | ☐ |
| 9 | Share R2 fetch + cache | ☐ |
| 10 | Directory listing fallback | ☐ |
| 11 | Polish | ☐ |

Legend: ☐ pending · ⏳ in progress · ✅ done

## Stage 1 — Scaffold

In progress.

- `package.json` — Hono 4, nanoid, Tailwind v4, wrangler
- `tsconfig.json` — strict, JSX → `hono/jsx`
- `wrangler.jsonc` — observability on, R2/KV/ASSETS bindings, two routes (apex + wildcard)
- `input.css` — Tailwind v4 entry + HTMX swap transitions
- `src/types.ts` — Bindings + ShareLink types
- `src/index.ts` — minimal app, `/health` + catch-all echo
- `.gitignore`, `.dev.vars.example`, `README.md`

Pending: `pnpm install` + first commit.
