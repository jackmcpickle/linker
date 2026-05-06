# Progress

Tracks implementation against [`docs/PLAN.md`](docs/PLAN.md).

| Stage | Title | Status |
|------:|-------|:------:|
| 1 | Scaffold | ✅ |
| 2 | SETUP docs (CF resources) | ✅ |
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

## Stage 1 — Scaffold ✅

- Hono 4 + TypeScript + Tailwind v4 + HTMX setup
- `wrangler.jsonc` with observability, R2/KV/ASSETS bindings, apex+wildcard routes
- Strict TS, JSX → `hono/jsx`
- `pnpm install` clean, typecheck green, css builds
- Committed.

## Stage 2 — SETUP docs ✅

`SETUP.md` covers: wrangler login, R2 bucket (`oc` hint), KV namespaces, Turnstile site (invisible), wildcard SSL options (ACM/Total TLS/SaaS), secrets, DNS, first deploy, Transmit config.

Wildcard cert flagged: free Universal SSL doesn't cover depth-2 wildcards — needs ACM ($10/mo) or CF for SaaS.

## Stage 3 — Worker dispatch

Pending.
