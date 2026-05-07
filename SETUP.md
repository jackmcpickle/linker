# Setup

One-time CF account + DNS work. Run before first deploy.

## 0. Prereqs

- `pnpm install` already done.
- `pnpm wrangler login` — auth wrangler against your CF account.
- `habitsofmind.com.au` zone is on Cloudflare (confirmed).

## 1. R2 bucket

```bash
pnpm wrangler r2 bucket create habits-linker-content --location oc
```

`oc` = Oceania (Sydney/Auckland-area), closest hint.

If the bucket name is taken in your account, pick another and update
`wrangler.jsonc → r2_buckets[0].bucket_name`.

## 2. KV namespaces

```bash
pnpm wrangler kv namespace create LINKS
pnpm wrangler kv namespace create THROTTLE
```

Each command prints an `id`. Paste into `wrangler.jsonc → kv_namespaces`:

```jsonc
"kv_namespaces": [
  { "binding": "LINKS",    "id": "<paste LINKS id>" },
  { "binding": "THROTTLE", "id": "<paste THROTTLE id>" }
]
```

## 3. Turnstile site

1. Dashboard → Turnstile → Add site (or edit existing).
2. Domains: `linker.habitsofmind.com.au`, `*.habitsofmind.com.au`.
3. Mode: **Invisible**.
4. Copy site key into `wrangler.jsonc → vars.TURNSTILE_SITE_KEY`.
5. Copy secret key — set as Worker secret in step 5.

## 4. Wildcard SSL cert

Free Universal SSL covers `*.habitsofmind.com.au` (depth-1) — no action needed.
Admin sits at `linker.habitsofmind.com.au` (single hostname, also covered).
Shares sit at `<token>.habitsofmind.com.au` (depth-1 wildcard, covered).

## 5. Secrets

Generate `COOKIE_HMAC_SECRET`:

```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Set all three:

```bash
pnpm wrangler secret put ADMIN_PASSWORD
pnpm wrangler secret put COOKIE_HMAC_SECRET
pnpm wrangler secret put TURNSTILE_SECRET_KEY
```

Each prompts for a value. Pipe via stdin if you want to avoid the prompt.

## 6. DNS records

For admin (`linker.habitsofmind.com.au`): Workers `custom_domain: true`
provisions this automatically on first deploy.

For shares (`*.habitsofmind.com.au`): add a proxied wildcard DNS record manually
before deploy.

Dashboard → DNS → Add record:

- Type: `AAAA`
- Name: `*`
- IPv6: `100::`
- Proxy: ✅ (orange cloud)

Or via API:

```bash
pnpm wrangler dns create habitsofmind.com.au '*' AAAA 100:: --proxied
```

(If wrangler doesn't expose `dns create` in your version, do it via the
dashboard.)

**Reserved subdomains.** The wildcard route `*.habitsofmind.com.au/*` catches
every subdomain. The worker checks the host: if it's not `linker` and the label
isn't a valid 10-char nanoid token, it throws — CF "Fail open" mode (set in step
6a) then bypasses the worker and uses the host's regular DNS record. So any
subdomain that needs to keep working (`www`, `info`, `autodiscover`, `mail`,
etc.) **must have its own explicit DNS record** that's more specific than the
wildcard. Specific records always take priority over the wildcard.

## 6a. Worker route failure mode (dashboard-only)

After first deploy, set the wildcard route to "Fail open" so unknown subs bypass
the worker to their own DNS records.

Dashboard → Workers & Pages → `linker` → Triggers → Routes → edit
`*.habitsofmind.com.au/*` → **Failure mode: Fail open (proceed)**. Save.

(Wrangler config can't set this — must be done in the dashboard. Default is
"Fail closed" which would block reserved subs.)

## 7. Local dev secrets

```bash
cp .dev.vars.example .dev.vars
# fill in real test secrets — Turnstile has free test keys at
# https://developers.cloudflare.com/turnstile/troubleshooting/testing/
```

For local dev, use Turnstile's "always passes" sitekey
`1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA` so
you don't need a real challenge during dev.

## 8. First deploy

```bash
pnpm tailwind     # build public/style.css
pnpm wrangler deploy
```

The admin custom domain is created on first deploy. Wildcard route is bound when
the deploy lands. Don't forget step 6a (Fail open).

## 9. Transmit (uploads)

Out of scope for the app, but for completeness:

1. Dashboard → R2 → Manage R2 API Tokens → Create API token.
2. Permission: Object Read & Write, scope to `habits-linker-content`.
3. Copy access key + secret + S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
4. Transmit → New connection → Server type: **S3-compatible**.
    - Server: `<account-id>.r2.cloudflarestorage.com`
    - Port: 443
    - Protocol: HTTPS
    - Access Key ID / Secret: from step 3
    - Region: `auto`
5. Create folders for each site you want to share, upload files. Then come back
   to the admin UI and create a share link pointing to that prefix.

## Verifying setup

```bash
pnpm wrangler whoami
pnpm wrangler r2 bucket list | grep habits-linker
pnpm wrangler kv namespace list | grep -E "LINKS|THROTTLE"
pnpm wrangler secret list
```

All four should show what you expect before first deploy.
