# habits-linker — Implementation Plan

Password-protected admin UI to mint expiring share links to R2 folders. Recipients browse content (static sites, images, files) until link expires.

## Architecture overview

- **Runtime:** Cloudflare Workers
- **Framework:** Hono (TypeScript)
- **UI:** Hono JSX SSR + HTMX v2 (CDN) + Tailwind v4 (standalone CLI)
- **Storage:** R2 (content) + KV (share metadata + login throttle)
- **Config:** `wrangler.jsonc` with observability enabled
- **No S3 migration** — greenfield R2 bucket
- **Uploads:** out of scope (user uses Transmit pointed at R2 S3-compat endpoint)

## Routing

Single Worker, two routes:

- `share.<root>/*` — admin UI at apex
- `*.share.<root>/*` — share serving via wildcard subdomain

Worker dispatches by `Host` header:

- Host == `SHARE_DOMAIN` (apex) → admin handlers
- Host == `<token>.<SHARE_DOMAIN>` → share serving, token = first label

## Data model (KV `LINKS` namespace)

Key: `link:<token>`
Value:

```ts
{
  token: string;           // 10-char nanoid, default alphabet
  name: string;            // admin label
  notes?: string;          // optional free text
  prefix: string;          // R2 key prefix, no leading slash, trailing slash optional
  createdAt: number;       // ms epoch
  expiresAt: number;       // ms epoch (absolute)
  revokedAt?: number;      // ms epoch if revoked
  viewCount: number;       // page-load increments only
  lastAccessedAt?: number; // ms epoch
}
```

KV `THROTTLE` namespace: `login:<ip>` → `{ fails: number, lockedUntil?: number }`.

Last-write-wins on PUT. No transactions.

## Tokens

- 10-char nanoid, default alphabet (~60 bits entropy)
- Apex collision impossible (apex is not a subdomain)
- No reserved-name list needed

## Admin auth

- Single password, stored as CF secret (`ADMIN_PASSWORD`)
- Constant-time compare
- HMAC-signed cookie (`COOKIE_HMAC_SECRET`), HttpOnly Secure SameSite=Strict
- 30-day sliding session — refresh cookie on each authed request
- **Invisible Turnstile** on login form
- Per-IP throttle: 5 fails / 15min → 15min lockout, keyed by `cf-connecting-ip`

## Recipient flow

1. Request to `<token>.share.<root>/*`
2. KV lookup `link:<token>` — if missing/revoked/expired → bare expiry page (`410` expired/revoked, `404` missing). Identical body for all three.
3. Check `share_validated` cookie (HMAC-signed, host-only on the token subdomain)
4. Cookie missing → serve invisible Turnstile interstitial → server-verify token → set cookie with TTL = `min(24h, expiresAt - now)`
5. Resolve path against R2 (see serving rules)
6. Edge cache lookup → R2 fetch → return + cache

## Serving rules (strict, with directory-listing fallback)

Path resolution order:

- `/` → `<prefix>/index.html`
- `/foo/` → `<prefix>/foo/index.html`
- Anything else → exact key `<prefix>/<path>`
- If exact-key miss AND path is "directory-shaped" (root or trailing-slash) AND prefix has children → render simple directory listing (file names, sizes, links)
- Else → bare `404` text response

No `.html` extension fallback. No SPA fallback. No bucket-provided `404.html` lookup.

MIME type from key extension (built-in map for common types).

Range requests honored via R2 `range` option (video/large files).

## Caching

- `caches.default.match/put` keyed by full URL
- HTML: 60s edge TTL
- Other assets: 1h edge TTL
- Skip cache: admin routes, expiry page, `4xx`/`5xx`
- Vary on `Range`
- Browser: `Cache-Control: no-store` always
- Token validity check ALWAYS runs uncached → revocation effective immediately

## Telemetry

- Increment `viewCount` + `lastAccessedAt` on top-level HTML page-loads only (response is HTML or path is `/` / `*.html`)
- Skip asset requests
- Cache hits short-circuit before counter (slight under-count acceptable)
- No IP/UA/path logs in KV
- Workers Observability captures everything else for debug

## Admin UI surface (HTMX-driven)

Routes:

- `GET /_admin` — login form OR list view (auth-gated)
- `POST /_admin/login` — verify password + Turnstile, set cookie
- `POST /_admin/logout` — clear cookie
- `GET /_admin/links` — list fragment (HTMX target)
- `POST /_admin/links` — create
- `PATCH /_admin/links/:token` — edit name/notes/prefix
- `POST /_admin/links/:token/extend` — set new `expiresAt` from now using preset
- `POST /_admin/links/:token/revoke` — set `revokedAt`
- `DELETE /_admin/links/:token` — hard delete (optional v1)
- `GET /_admin/prefixes?q=...` — typeahead via `bucket.list({ prefix: q, delimiter: "/" })`

Components:

- Login page: minimal, single password field, invisible Turnstile, lockout message after threshold
- List view: table of shares with `name`, `prefix`, `expires in X`, `viewCount · lastAccessedAt`, action buttons
- Empty state: "No shares yet — create one ↑" + create form prominent
- Create form: name input, prefix typeahead, expiry preset chips (1h / 6h / 1d / 3d / 1w / 1mo, default 1w), notes textarea, submit
- Edit row: HTMX inline edit, swaps `<tr>` on save
- Revoke: confirm prompt, swaps row to revoked state
- Extend: same preset chips, sets new absolute expiry from now
- Times rendered as `<time datetime="ISO">…</time>` with small client script for browser-local TZ

## Expiry presets

```ts
const PRESETS = [
    { label: '1h', ms: 3600_000 },
    { label: '6h', ms: 21600_000 },
    { label: '1d', ms: 86400_000 },
    { label: '3d', ms: 259200_000 },
    { label: '1w', ms: 604800_000 }, // default
    { label: '1mo', ms: 2592000_000 },
];
```

Floor 1h, ceiling 1y (server-side validation).

## Expiry page

```html
<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>Link expired</title>
        <style>
            body {
                font-family: system-ui;
                display: grid;
                place-items: center;
                height: 100dvh;
                margin: 0;
            }
            h1 {
                font-weight: 400;
            }
        </style>
    </head>
    <body>
        <h1>This link has expired</h1>
    </body>
</html>
```

Same body for expired, revoked, never-existed. Status: `410` expired/revoked, `404` missing.

## `wrangler.jsonc`

```jsonc
{
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "habits-linker",
    "main": "src/index.ts",
    "compatibility_date": "2025-01-01",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true, "head_sampling_rate": 1 },
    "routes": [
        { "pattern": "share.<root>/*", "custom_domain": true },
        { "pattern": "*.share.<root>/*", "zone_name": "<root>" },
    ],
    "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "habits-linker-content" }],
    "kv_namespaces": [
        { "binding": "LINKS", "id": "..." },
        { "binding": "THROTTLE", "id": "..." },
    ],
    "vars": {
        "SHARE_DOMAIN": "share.<root>",
        "TURNSTILE_SITE_KEY": "...",
    },
}
```

Secrets via `wrangler secret put`:

- `ADMIN_PASSWORD`
- `COOKIE_HMAC_SECRET` (random 32+ bytes; rotation invalidates all sessions)
- `TURNSTILE_SECRET_KEY`

## R2 bucket setup

```bash
wrangler r2 bucket create habits-linker-content --location oc
```

`oc` location hint = Oceania (Sydney/Auckland-area), closest to user.

R2 access keys for Transmit: generated separately via R2 dashboard, out of scope for this app.

## Project structure

```
habits-linker/
├── docs/
│   └── PLAN.md (this file)
├── public/
│   └── style.css (Tailwind output, gitignored, built)
├── src/
│   ├── index.ts (Hono app, route dispatch)
│   ├── admin/
│   │   ├── routes.ts
│   │   ├── auth.ts (cookie HMAC, Turnstile verify, throttle)
│   │   └── views/ (JSX components)
│   ├── share/
│   │   ├── routes.ts (token gate, recipient cookie, R2 fetch)
│   │   ├── interstitial.tsx (Turnstile challenge page)
│   │   ├── expired.tsx (bare expiry page)
│   │   └── listing.tsx (directory listing fallback)
│   ├── kv/
│   │   └── links.ts (CRUD on LINKS namespace)
│   ├── lib/
│   │   ├── cookie.ts (HMAC sign/verify)
│   │   ├── nanoid.ts (token generation)
│   │   ├── mime.ts (extension → MIME map)
│   │   └── turnstile.ts (server-side verify)
│   └── types.ts
├── tailwind.config.css (v4 inline config)
├── input.css (Tailwind directives)
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── .dev.vars (gitignored, local secrets)
```

## Build + dev

```bash
pnpm install
pnpm tailwind   # build public/style.css (watch mode in dev)
pnpm dev        # wrangler dev --remote (uses real R2 + KV)
pnpm deploy     # wrangler deploy
```

## Implementation stages

1. **Scaffold** — Hono CF Workers template, TypeScript, Tailwind, HTMX, nanoid
2. **Bindings + secrets** — create R2 bucket (oc), KV namespaces, set secrets, wire `wrangler.jsonc`
3. **Worker dispatch** — Host-based routing (apex vs subdomain)
4. **Admin auth** — login page, Turnstile, password compare, HMAC cookie, throttle, middleware
5. **Admin CRUD** — list, create, edit, extend, revoke routes + JSX views + HTMX wiring
6. **Typeahead** — `bucket.list` endpoint + HTMX `hx-trigger="input changed delay:200ms"`
7. **Share serving — token gate** — KV lookup, expiry page (3 cases unified)
8. **Share serving — interstitial** — Turnstile challenge, cookie issuance
9. **Share serving — R2 fetch** — path resolution, MIME, range requests, edge cache, view counter
10. **Directory listing fallback** — when no `index.html` and prefix has children
11. **Polish** — empty state, browser-local TZ rendering, error pages, observability log structure

## Operational notes

- Single env (prod). Local iteration via `wrangler dev --remote`.
- Concurrent admin tabs: last-write-wins on KV PUT (no transactions).
- `COOKIE_HMAC_SECRET` rotation invalidates all sessions (admin + recipient). Manual procedure: `wrangler secret put COOKIE_HMAC_SECRET`.
- No KV backup. If KV is wiped, all share metadata is gone; existing recipient links fail token gate. R2 content unaffected.
- Workers Logs visible in CF dashboard. No external sink in v1.
- Social link unfurls (Slack/iMessage/Gmail) will see Turnstile interstitial, no preview thumbnail. Acceptable / arguably correct for private content.

## Decisions deferred / non-goals (v1)

- Multiple admin users with separate accounts
- Audit log of admin mutations
- Per-share password
- Custom slug (admin-chosen subdomain) instead of nanoid
- File listing UI for browsing R2 in admin (only typeahead)
- Upload UI (Transmit handles uploads)
- D1 / Durable Object usage (KV is sufficient at expected scale)
- Multi-environment (dev/staging/prod)
- External tracing sink (Honeycomb / Axiom / Baselime)
- KV → external backup
- Per-share toggles (e.g., enable SPA fallback)
- Custom error pages from bucket (`404.html`)
- Browser-side caching of assets (`no-store` enforced)
