import { Hono } from 'hono';
import type { ShareEnv } from '../types';
import { classifyHost } from '../lib/dispatch';
import { shareGate } from './gate';
import { buildShareCookie, hasValidShareCookie } from './cookie';
import { InterstitialPage } from './views/interstitial';
import { verifyTurnstile } from '../lib/turnstile';
import { serveShare } from './serve';
import { log } from '../lib/log';

const share = new Hono<ShareEnv>();

// Asset passthrough — the challenge bootstrap script only.
// Other admin assets are not exposed on share subdomains.
share.get('/__challenge.js', async (c) => c.env.ASSETS.fetch(c.req.raw));

// Parse token from Host.
share.use('*', async (c, next) => {
    const host = c.req.header('host') ?? '';
    const cls = classifyHost(host, c.env.SHARE_DOMAIN, c.env.ADMIN_HOST);
    if (cls.kind !== 'share') return c.text('not a share host', 400);
    c.set('token', cls.token);
    await next();
});

// Token gate — KV lookup; expired/revoked/missing → bare expiry page.
share.use('*', shareGate);

// Verify endpoint — POST'ed by the interstitial after Turnstile solves.
share.post('/__verify', async (c) => {
    const link = c.get('link');
    const form = await c.req.formData();
    const tsToken = String(form.get('cf-turnstile-response') ?? '');
    const next = safeNext(String(form.get('next') ?? '/'));

    const ts = await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET_KEY, clientIp(c));
    if (!ts.ok) {
        log({ event: 'share.verify.fail', token: link.token, errors: ts.errors });
        return c.text('verification failed', 400, { 'Cache-Control': 'no-store' });
    }

    const cookie = await buildShareCookie(c, link, c.env.COOKIE_HMAC_SECRET);
    if (!cookie) return c.text('share expired', 410, { 'Cache-Control': 'no-store' });

    log({ event: 'share.verify.ok', token: link.token });

    return new Response(null, {
        status: 303,
        headers: {
            Location: next,
            'Set-Cookie': cookie,
            'Cache-Control': 'no-store',
        },
    });
});

// Recipient cookie gate — render interstitial if cookie missing/invalid.
share.use('*', async (c, next) => {
    const link = c.get('link');
    const ok = await hasValidShareCookie(c, link.token, c.env.COOKIE_HMAC_SECRET);
    if (ok) return next();

    const url = new URL(c.req.url);
    return c.html(
        <InterstitialPage
            turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
            next={url.pathname + url.search}
        />,
        200,
        { 'Cache-Control': 'no-store' },
    );
});

// Serve content. Only GET/HEAD allowed — anything else (POST/PUT/DELETE)
// is bogus on a read-only share.
share.on(['GET', 'HEAD'], '*', async (c) => {
    const link = c.get('link');
    return serveShare(c, link, c.executionCtx);
});

share.all('*', (c) => c.text('method not allowed', 405));

// ---------- helpers ----------

function safeNext(input: string): string {
    if (!input.startsWith('/')) return '/';
    if (input.startsWith('//')) return '/'; // protocol-relative bypass
    if (input.includes('\n') || input.includes('\r')) return '/'; // header injection
    return input;
}

function clientIp(c: {
    req: { header: (name: string) => string | undefined };
}): string | undefined {
    return c.req.header('cf-connecting-ip');
}

export default share;
