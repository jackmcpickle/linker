import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signJSON } from '../../lib/cookie';
import { putLink, getLink } from '../../kv/links';
import type { ShareLink } from '../../types';
import { SHARE_COOKIE } from '../cookie';

function urlFor(token: string, path = '/'): string {
    return `http://${token}.example.test${path}`;
}

async function emptyAll() {
    let cursor: string | undefined;
    do {
        const res = await env.LINKS.list({ prefix: 'link:', cursor });
        for (const k of res.keys) await env.LINKS.delete(k.name);
        cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
    let r2cursor: string | undefined;
    do {
        const res: R2Objects = await env.BUCKET.list({
            limit: 1000,
            cursor: r2cursor,
        });
        if (res.objects.length > 0) {
            await env.BUCKET.delete(res.objects.map(o => o.key));
        }
        r2cursor = res.truncated ? res.cursor : undefined;
    } while (r2cursor);
}

afterEach(emptyAll);

async function shareCookieFor(link: ShareLink): Promise<string> {
    const now = Date.now();
    const value = await signJSON(
        { token: link.token, iat: now, exp: now + 60 * 60 * 1000 },
        env.COOKIE_HMAC_SECRET as string,
    );
    return `${SHARE_COOKIE}=${value}`;
}

async function seedPair(opts: {
    prefix: string;
    name?: string;
}): Promise<{ browse: ShareLink; download: ShareLink }> {
    const now = Date.now();
    const browse: ShareLink = {
        token: 'browseabcd',
        name: opts.name ?? 'Test share',
        prefix: opts.prefix,
        createdAt: now,
        expiresAt: now + 86_400_000,
        viewCount: 0,
        linkType: 'browse',
        pairedToken: 'downloadab',
    };
    const download: ShareLink = {
        token: 'downloadab',
        name: opts.name ?? 'Test share',
        prefix: opts.prefix,
        createdAt: now,
        expiresAt: now + 86_400_000,
        viewCount: 0,
        downloadCount: 0,
        linkType: 'download',
        pairedToken: 'browseabcd',
    };
    await putLink(env.LINKS, browse);
    await putLink(env.LINKS, download);
    return { browse, download };
}

function hostFor(token: string): string {
    return `${token}.example.test`;
}

describe('share download — landing page', () => {
    beforeEach(emptyAll);

    it('renders Download button on /', async () => {
        await env.BUCKET.put('photos/a.txt', 'aa');
        await env.BUCKET.put('photos/b.txt', 'bb');
        const { download } = await seedPair({
            prefix: 'photos/',
            name: 'Photos',
        });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/'), {
            headers: { host: hostFor(download.token), cookie },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Photos');
        expect(html).toContain('photos/');
        expect(html).toContain('href="/__download"');
        expect(html).toContain('Download');
    });

    it('renders interstitial without a cookie', async () => {
        const { download } = await seedPair({ prefix: 'photos/' });
        const res = await SELF.fetch(urlFor(download.token, '/'), {
            headers: { host: hostFor(download.token) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        // The interstitial form has a `next` field pointing back at /
        expect(html.toLowerCase()).toContain('turnstile');
    });
});

describe('share download — action streams', () => {
    beforeEach(emptyAll);

    it('streams a single file as attachment', async () => {
        await env.BUCKET.put('docs/report.pdf', 'pdf-bytes', {
            httpMetadata: { contentType: 'application/pdf' },
        });
        const { download } = await seedPair({
            prefix: 'docs/report.pdf',
            name: 'Report',
        });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/__download'), {
            headers: { host: hostFor(download.token), cookie },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
        expect(res.headers.get('content-disposition')).toContain('report.pdf');
        expect(await res.text()).toBe('pdf-bytes');
    });

    it('streams a folder as zip', async () => {
        await env.BUCKET.put('photos/a.txt', 'aaaa');
        await env.BUCKET.put('photos/sub/b.txt', 'bbbb');
        const { download } = await seedPair({ prefix: 'photos/' });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/__download'), {
            headers: { host: hostFor(download.token), cookie },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/zip');
        const buf = new Uint8Array(await res.arrayBuffer());
        // Local file header signature 'PK\x03\x04'
        expect(buf[0]).toBe(0x50);
        expect(buf[1]).toBe(0x4b);
        expect(buf[2]).toBe(0x03);
        expect(buf[3]).toBe(0x04);
    });

    it('increments downloadCount on a successful action', async () => {
        await env.BUCKET.put('docs/r.pdf', 'data');
        const { download } = await seedPair({ prefix: 'docs/r.pdf' });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/__download'), {
            headers: { host: hostFor(download.token), cookie },
        });
        // Drain the body so the request is fully complete before checking KV.
        await res.arrayBuffer();
        // waitUntil fires off the KV write; poll briefly for the bump.
        let attempts = 0;
        let after = await getLink(env.LINKS, download.token);
        while ((after?.downloadCount ?? 0) === 0 && attempts < 10) {
            await new Promise(r => setTimeout(r, 25));
            after = await getLink(env.LINKS, download.token);
            attempts += 1;
        }
        expect(after?.downloadCount ?? 0).toBeGreaterThanOrEqual(1);
    });

    it('renders error page for empty folder', async () => {
        await env.BUCKET.put('empty/.keep', new Uint8Array(0));
        const { download } = await seedPair({ prefix: 'empty/' });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/__download'), {
            headers: { host: hostFor(download.token), cookie },
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html.toLowerCase()).toContain('empty');
    });

    it('returns expired page for revoked link', async () => {
        await env.BUCKET.put('docs/r.pdf', 'data');
        const { download } = await seedPair({ prefix: 'docs/r.pdf' });
        await putLink(env.LINKS, { ...download, revokedAt: Date.now() });
        const cookie = await shareCookieFor(download);

        const res = await SELF.fetch(urlFor(download.token, '/__download'), {
            headers: { host: hostFor(download.token), cookie },
        });
        expect(res.status).toBe(410);
    });
});

describe('browse-type link is unaffected', () => {
    beforeEach(emptyAll);

    it('browse subdomain serves listing, not the download landing', async () => {
        await env.BUCKET.put('photos/a.txt', 'aa');
        const { browse } = await seedPair({ prefix: 'photos/' });
        const cookie = await shareCookieFor(browse);

        const res = await SELF.fetch(urlFor(browse.token, '/'), {
            headers: { host: hostFor(browse.token), cookie },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Index of /');
        expect(html).not.toContain('href="/__download"');
    });
});
