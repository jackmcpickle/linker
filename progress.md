# Progress

Tracks implementation against [`docs/PLAN.md`](docs/PLAN.md).

| Stage | Title | Status |
|------:|-------|:------:|
| 1 | Scaffold | ✅ |
| 2 | SETUP docs (CF resources) | ✅ |
| 3 | Worker dispatch (host-based routing) | ✅ |
| 4 | Admin auth | ✅ |
| 5 | Admin CRUD | ✅ |
| 6 | Typeahead prefix picker | ✅ |
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

## Stage 3 — Worker dispatch ✅

- `src/lib/dispatch.ts` — `classifyHost(host, shareDomain)` → `admin` | `share{token}` | `unknown`
- Apex of `SHARE_DOMAIN`, `localhost`, `127.0.0.1` → admin
- `<token>.<SHARE_DOMAIN>`, `<token>.localhost` → share
- `src/index.ts` — top-level fetch dispatches to `adminApp` or `shareApp`; `/health` short-circuited
- `src/admin/routes.ts` — placeholder admin Hono app
- `src/share/routes.ts` — placeholder share Hono app, parses token from host via shared classifier

Each sub-app is self-contained — the share app re-classifies host so it's testable in isolation.

## Stage 4 — Admin auth ✅

- `src/lib/cookie.ts` — HMAC-SHA256 sign/verify (Web Crypto), b64url helpers, constant-time compare, `buildSetCookie`/`clearCookie`/`readCookie`
- `src/lib/turnstile.ts` — server-side `siteverify` POST
- `src/lib/throttle.ts` — KV-backed per-IP login throttle (5 fails / 15min → 15min lockout, 15min TTL on the KV row)
- `src/admin/auth.ts` — session cookie (`admin_session`, 30-day sliding), `requireAuth` middleware, `clientIp` from `cf-connecting-ip`, conditional `Secure` based on request scheme
- `src/admin/views/layout.tsx` — base HTML, includes Tailwind CSS + HTMX v2 CDN + (conditional) Turnstile script
- `src/admin/views/login.tsx` — invisible Turnstile, password input, error/lockout banners; widget bootstrap in `public/login.js`
- `src/admin/views/dashboard.tsx` — placeholder authed landing
- `src/admin/routes.tsx` — `/_admin` GET (login or dash), `/_admin/login` POST (throttle → Turnstile → password compare → set cookie), `/_admin/logout` POST, asset passthrough for `style.css`/`login.js`/`favicon.ico`
- Typecheck green, css rebuilt

## Stage 5 — Admin CRUD ✅

- `src/lib/nanoid.ts` — `customAlphabet` 36-char lowercase alphanumeric, 10 chars (~2^51 entropy), hostname-safe; `isValidToken`
- `src/lib/expiry.ts` — preset chips (1h/6h/1d/3d/1w/1mo), `DEFAULT_PRESET = '1w'`, `presetMs(id)`
- `src/lib/time.ts` — `isoAt`, `relative`, `absolute` (server-side render; client refines per-TZ in `admin.js`)
- `src/kv/links.ts` — `getLink`/`putLink`/`deleteLink`/`listLinks` against `LINKS` KV. Records duplicated in metadata so `list` returns the dashboard data in one call.
- `src/admin/views/link-row.tsx` — view + edit modes, status badge (active/expired/revoked), copy URL button, extend menu (preset chips), edit/revoke/delete buttons all HTMX-driven
- `src/admin/views/link-form.tsx` — create form with name, prefix, notes, preset chips (peer-checked styling)
- `src/admin/views/dashboard.tsx` — full page with create form + `LinkList` (also exported for HTMX swap targets); empty state when no links
- `public/admin.js` — TZ-local time rendering for `<time data-time-rel>`, clipboard buttons, re-binds after `htmx:afterSwap`
- `src/admin/routes.tsx` — full CRUD: GET `/_admin/links` (list), POST (create), GET `:token` (cancel-edit re-fetch), GET `:token/edit` (edit form), PATCH `:token` (save), POST `:token/extend`, POST `:token/revoke`, DELETE `:token`. Typeahead stub returns empty for stage 6.

Extending un-revokes (sets new expiry, clears `revokedAt`).

## Stage 6 — Typeahead ✅

- `GET /_admin/prefixes?prefix=...` calls `BUCKET.list({ prefix, delimiter: '/', limit: 50 })`, returns up to 12 folders + 12 files
- `src/admin/views/suggestions.tsx` — folders/files sections, clickable buttons with `data-suggestion`
- `public/admin.js` — click on any `[data-suggestion]` writes value into the closest form's `name="prefix"` input and clears the panel via `replaceChildren()`
- Create form's prefix input fires `hx-trigger="input changed delay:200ms, focus"` against the endpoint; suggestions render into `#prefix-suggestions`

## Stage 7 — Share token gate + expiry page

Pending.
