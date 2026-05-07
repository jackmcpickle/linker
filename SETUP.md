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

If the bucket name is taken in your account, pick another and update `wrangler.jsonc → r2_buckets[0].bucket_name`.

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

1. Dashboard → Turnstile → Add site.
2. Domain: `linker.habitsofmind.com.au`.
3. Mode: **Invisible**.
4. Copy site key into `wrangler.jsonc → vars.TURNSTILE_SITE_KEY`.
5. Copy secret key — set as Worker secret in step 5.

## 4. Wildcard SSL cert (the only fiddly bit)

CF free Universal SSL covers `*.habitsofmind.com.au` (depth 1). It does **not** cover `*.linker.habitsofmind.com.au` (depth 2).

Pick one option:

- **A. Advanced Certificate Manager** (~$10/mo). Dashboard → SSL/TLS → Edge Certificates → Order Advanced Certificate. Hostnames: `linker.habitsofmind.com.au`, `*.linker.habitsofmind.com.au`. Validation: TXT record (auto). Cleanest path.
- **B. Total TLS** (Pro plan or higher). Auto-issues certs for all subdomains. Bundled with paid plans.
- **C. Cloudflare for SaaS Custom Hostnames** (free up to 100 hostnames). Each share token would register as a custom hostname on creation, cert provisioned per-hostname. Adds wrangler API call to share creation flow. Free, but more code.

**Recommended: A** for simplicity. C is the free path if cost is the issue.

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

For the apex (`linker.habitsofmind.com.au`): Workers `custom_domain: true` provisions this automatically on first deploy.

For the wildcard (`*.linker.habitsofmind.com.au`): add a proxied DNS record manually before deploy.

Dashboard → DNS → Add record:

- Type: `AAAA`
- Name: `*.linker`
- IPv6: `100::`
- Proxy: ✅ (orange cloud)

Or via API:

```bash
pnpm wrangler dns create habitsofmind.com.au '*.linker' AAAA 100:: --proxied
```

(If wrangler doesn't expose `dns create` in your version, do it via the dashboard.)

The Worker route `*.linker.habitsofmind.com.au/*` will catch traffic once the cert exists.

## 7. Local dev secrets

```bash
cp .dev.vars.example .dev.vars
# fill in real test secrets — Turnstile has free test keys at
# https://developers.cloudflare.com/turnstile/troubleshooting/testing/
```

For local dev, use Turnstile's "always passes" sitekey `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA` so you don't need a real challenge during dev.

## 8. First deploy

```bash
pnpm tailwind     # build public/style.css
pnpm wrangler deploy
```

The custom domain for the apex is created on first deploy. Wildcard route is bound when the deploy lands.

## 9. Transmit (uploads)

Out of scope for the app, but for completeness:

1. Dashboard → R2 → Manage R2 API Tokens → Create API token.
2. Permission: Object Read & Write, scope to `habits-linker-content`.
3. Copy access key + secret + S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
4. Transmit → New connection → Server type: **S3-compatible**.
    - Server: `<account-id>.r2.cloudflarestorage.com`
    - Port: 443
    - Protocol: HTTPS
    - Access Key ID / Secret: from step 3
    - Region: `auto`
5. Create folders for each site you want to share, upload files. Then come back to the admin UI and create a share link pointing to that prefix.

## Verifying setup

```bash
pnpm wrangler whoami
pnpm wrangler r2 bucket list | grep habits-linker
pnpm wrangler kv namespace list | grep -E "LINKS|THROTTLE"
pnpm wrangler secret list
```

All four should show what you expect before first deploy.
