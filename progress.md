# Progress

Tracks implementation against [`docs/PLAN.md`](docs/PLAN.md).

| Stage | Title                                | Status |
| ----: | ------------------------------------ | :----: |
|     1 | Scaffold                             |   ✅   |
|     2 | SETUP docs (CF resources)            |   ✅   |
|     3 | Worker dispatch (host-based routing) |   ✅   |
|     4 | Admin auth                           |   ✅   |
|     5 | Admin CRUD                           |   ✅   |
|     6 | Typeahead prefix picker              |   ✅   |
|     7 | Share token gate + expiry page       |   ✅   |
|     8 | Share Turnstile interstitial         |   ✅   |
|     9 | Share R2 fetch + cache               |   ✅   |
|    10 | Directory listing fallback           |   ✅   |
|    11 | Polish                               |   ✅   |
|    12 | Flatten domain (depth-1 + fail-open) |   ✅   |

Legend: ☐ pending · ⏳ in progress · ✅ done

## Stage 1 — Scaffold ✅

- Hono 4 + TypeScript + Tailwind v4 + HTMX setup
- `wrangler.jsonc` with observability, R2/KV/ASSETS bindings, apex+wildcard
  routes
- Strict TS, JSX → `hono/jsx`
- `pnpm install` clean, typecheck green, css builds
- Committed.

## Stage 2 — SETUP docs ✅

`SETUP.md` covers: wrangler login, R2 bucket (`oc` hint), KV namespaces,
Turnstile site (invisible), wildcard SSL options (ACM/Total TLS/SaaS), secrets,
DNS, first deploy, Transmit config.

Wildcard cert flagged: free Universal SSL doesn't cover depth-2 wildcards —
needs ACM ($10/mo) or CF for SaaS.

## Stage 3 — Worker dispatch ✅

- `src/lib/dispatch.ts` — `classifyHost(host, shareDomain)` → `admin` |
  `share{token}` | `unknown`
- Apex of `SHARE_DOMAIN`, `localhost`, `127.0.0.1` → admin
- `<token>.<SHARE_DOMAIN>`, `<token>.localhost` → share
- `src/index.ts` — top-level fetch dispatches to `adminApp` or `shareApp`;
  `/health` short-circuited
- `src/admin/routes.ts` — placeholder admin Hono app
- `src/share/routes.ts` — placeholder share Hono app, parses token from host via
  shared classifier

Each sub-app is self-contained — the share app re-classifies host so it's
testable in isolation.

## Stage 4 — Admin auth ✅

- `src/lib/cookie.ts` — HMAC-SHA256 sign/verify (Web Crypto), b64url helpers,
  constant-time compare, `buildSetCookie`/`clearCookie`/`readCookie`
- `src/lib/turnstile.ts` — server-side `siteverify` POST
- `src/lib/throttle.ts` — KV-backed per-IP login throttle (5 fails / 15min →
  15min lockout, 15min TTL on the KV row)
- `src/admin/auth.ts` — session cookie (`admin_session`, 30-day sliding),
  `requireAuth` middleware, `clientIp` from `cf-connecting-ip`, conditional
  `Secure` based on request scheme
- `src/admin/views/layout.tsx` — base HTML, includes Tailwind CSS + HTMX v2
  CDN + (conditional) Turnstile script
- `src/admin/views/login.tsx` — invisible Turnstile, password input,
  error/lockout banners; widget bootstrap in `public/login.js`
- `src/admin/views/dashboard.tsx` — placeholder authed landing
- `src/admin/routes.tsx` — `/_admin` GET (login or dash), `/_admin/login` POST
  (throttle → Turnstile → password compare → set cookie), `/_admin/logout` POST,
  asset passthrough for `style.css`/`login.js`/`favicon.ico`
- Typecheck green, css rebuilt

## Stage 5 — Admin CRUD ✅

- `src/lib/nanoid.ts` — `customAlphabet` 36-char lowercase alphanumeric, 10
  chars (~2^51 entropy), hostname-safe; `isValidToken`
- `src/lib/expiry.ts` — preset chips (1h/6h/1d/3d/1w/1mo),
  `DEFAULT_PRESET = '1w'`, `presetMs(id)`
- `src/lib/time.ts` — `isoAt`, `relative`, `absolute` (server-side render;
  client refines per-TZ in `admin.js`)
- `src/kv/links.ts` — `getLink`/`putLink`/`deleteLink`/`listLinks` against
  `LINKS` KV. Records duplicated in metadata so `list` returns the dashboard
  data in one call.
- `src/admin/views/link-row.tsx` — view + edit modes, status badge
  (active/expired/revoked), copy URL button, extend menu (preset chips),
  edit/revoke/delete buttons all HTMX-driven
- `src/admin/views/link-form.tsx` — create form with name, prefix, notes, preset
  chips (peer-checked styling)
- `src/admin/views/dashboard.tsx` — full page with create form + `LinkList`
  (also exported for HTMX swap targets); empty state when no links
- `public/admin.js` — TZ-local time rendering for `<time data-time-rel>`,
  clipboard buttons, re-binds after `htmx:afterSwap`
- `src/admin/routes.tsx` — full CRUD: GET `/_admin/links` (list), POST (create),
  GET `:token` (cancel-edit re-fetch), GET `:token/edit` (edit form), PATCH
  `:token` (save), POST `:token/extend`, POST `:token/revoke`, DELETE `:token`.
  Typeahead stub returns empty for stage 6.

Extending un-revokes (sets new expiry, clears `revokedAt`).

## Stage 6 — Typeahead ✅

- `GET /_admin/prefixes?prefix=...` calls
  `BUCKET.list({ prefix, delimiter: '/', limit: 50 })`, returns up to 12
  folders + 12 files
- `src/admin/views/suggestions.tsx` — folders/files sections, clickable buttons
  with `data-suggestion`
- `public/admin.js` — click on any `[data-suggestion]` writes value into the
  closest form's `name="prefix"` input and clears the panel via
  `replaceChildren()`
- Create form's prefix input fires
  `hx-trigger="input changed delay:200ms, focus"` against the endpoint;
  suggestions render into `#prefix-suggestions`

## Stage 7 — Share token gate + expiry page ✅

- `src/share/views/expired.tsx` — bare page, inline `<style>`,
  prefers-color-scheme aware, identical body for all three cases
- `src/share/gate.tsx` —
  `evaluateToken(kv, token, now) → ok | missing | revoked | expired`,
  `expiryResponse(c, kind)` (404 missing, 410 revoked/expired,
  `Cache-Control: no-store`, `X-Robots-Tag: noindex,nofollow`), `shareGate`
  middleware
- `src/types.ts` — pulled `ShareEnv` (Bindings + Variables) into shared types
- `src/share/routes.tsx` — adds `shareGate` after host classifier; valid token
  attaches `link` to context for stages 8–10

## Stage 8 — Share interstitial ✅

- `src/share/cookie.ts` — host-only `share_validated` cookie. TTL =
  `min(24h, expiresAt - now)`. Signed `{ token, iat, exp }`.
- `src/share/views/interstitial.tsx` — full-page invisible Turnstile, hidden
  form with `next` path, posts to `/__verify`
- `public/__challenge.js` — explicit Turnstile render, auto-execute,
  error-callback retry
- `src/share/routes.tsx` flow:
    - `/__challenge.js` → ASSETS passthrough (only share asset exposed)
    - host classifier → token gate → `/__verify` POST (verifies Turnstile, sets
      cookie, 303 to `next`)
    - cookie gate → no cookie → render interstitial; cookie present → next
      handler
- `safeNext()` rejects protocol-relative + CRLF injection in `next` param

## Stage 9 — Share R2 fetch + cache ✅

- `src/lib/mime.ts` — extension → MIME map (~30 common types), `isHtmlMime`
- `src/lib/range.ts` — single-range parser → R2 range shape (`offset/length` or
  `suffix`)
- `src/share/serve.ts`
    - `resolveKey(prefix, path)` strict: `/` → `<prefix>/index.html`, `/foo/` →
      `<prefix>/foo/index.html`, else 1:1
    - `fetchFromR2` honors `Range` header, sets `Accept-Ranges`, `ETag`,
      `Last-Modified`, returns 206 + `Content-Range` for partial
    - Edge cache via `caches.default` keyed on full URL + Range; HTML 60s,
      assets 1h; `Vary: Range`
    - Browser-facing response forced to `Cache-Control: no-store`
    - `r2.body.tee()` splits one R2 stream into edge-write + browser-stream
      concurrently
    - `viewCount`/`lastAccessedAt` bumped via `ctx.waitUntil` only on `200` HTML
      responses
- Routes: `share.on(['GET','HEAD'], '*', serveShare)`; non-GET/HEAD → 405
- 404 from R2 currently returns plain text — replaced by directory listing
  fallback in stage 10

## Stage 10 — Directory listing fallback ✅

- `src/share/views/listing.tsx` — bare HTML directory index, ../parent link,
  alphabetically-sorted folders then files, sizes formatted,
  prefers-color-scheme aware
- `src/share/serve.tsx` (renamed from .ts):
    - `listingPrefix(sharePrefix, path)` builds the R2 list prefix for a
      directory request
    - `buildListing(bucket, sharePrefix, path)` returns null when prefix has no
      children, else `[folders, files]` with share-relative `href` and sizes
    - `parentPath(path)` for `../` navigation (undefined at root)
    - On R2 miss + directory-shaped path → render listing, cached at HTML edge
      TTL (60s) like any other HTML response, view counter still bumped
    - Strict file paths (no trailing slash) still 404 as before — no
      auto-promotion
- One R2 stream split via `tee()` for both edge cache write + browser response

## Stage 11 — Polish ✅

- `src/lib/log.ts` — `log({event, ...})` JSON line logger; visible in CF Workers
  Logs
- Logged events:
    - `admin.login.ok` / `password_fail` / `turnstile_fail`
    - `admin.link.{create,extend,revoke,delete}` with token + relevant fields
    - `share.gate.reject` { token, kind: missing|revoked|expired }
    - `share.verify.{ok,fail}` with errors
    - `fetch.error` (top-level catch) with message + stack
- `src/index.ts` — top-level try/catch returns generic 500 (`no-store`), logs
  full error
- Empty-state admin UI already shipped in stage 5
- Browser-local TZ rendering via `admin.js` already shipped in stage 5
- Typecheck green, css rebuilt

## Stage 12 — Flatten domain ✅

Sidestep ACM cost by collapsing shares from depth-2 to depth-1 wildcard.

- Routes: admin stays at `linker.habitsofmind.com.au` (custom_domain). Shares
  move to `<token>.habitsofmind.com.au` (was `<token>.linker.…`). Both depth-1 →
  covered by free Universal SSL.
- `wrangler.jsonc` — wildcard route `*.habitsofmind.com.au/*` (zone_name
  unchanged); `vars.SHARE_DOMAIN = "habitsofmind.com.au"`; new
  `vars.ADMIN_HOST = "linker.habitsofmind.com.au"`.
- `src/types.ts` — `ADMIN_HOST: string` added to `Bindings`.
- `src/lib/dispatch.ts` — `classifyHost(host, shareDomain, adminHost)`. Admin
  matched by exact `adminHost`. Share label gated by strict `isValidToken`
  (10-char `[a-z0-9]`) so reserved subs (`www`, `info`, `autodiscover`,
  `linker`, …) all classify as `unknown`.
- `src/index.ts` — `unknown` host throws BEFORE try/catch so the exception is
  uncaught. Combined with CF Worker Route "Fail open (proceed)", unknown subs
  bypass the worker to their own DNS records.
- `SETUP.md` — cert section reduced to "Universal SSL covers it"; DNS wildcard
  `*.linker` → `*`; new section 6a for the dashboard fail-open toggle.
- Post-deploy cleanup: delete DNS `*.linker` record; cancel ACM cert.

## Done

All stages complete. Pre-deploy checklist:

1. Follow `SETUP.md` for CF resources (R2, KV, secrets, Turnstile, DNS).
2. Replace placeholders in `wrangler.jsonc` (KV namespace IDs, Turnstile site
   key).
3. `pnpm tailwind && pnpm wrangler deploy`.
4. Dashboard step 6a: set wildcard route Failure mode = **Fail open**.
5. Post-deploy cleanup: delete `*.linker.habitsofmind.com.au` DNS record +
   cancel ACM cert.
6. Test login → create share → visit `<token>.habitsofmind.com.au` → Turnstile →
   content serves; `www.habitsofmind.com.au` still reaches existing origin.
