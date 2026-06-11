import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signJSON } from '../../lib/cookie';
import { getLink, putLink } from '../../kv/links';
import type { ShareLink } from '../../types';

let sessionCookie = '';
const BASE = 'http://localhost';

async function emptyLinks() {
    let cursor: string | undefined;
    do {
        const res = await env.LINKS.list({ prefix: 'link:', cursor });
        for (const k of res.keys) {
            await env.LINKS.delete(k.name);
        }
        cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
}

afterEach(emptyLinks);

beforeAll(async () => {
    const now = Date.now();
    const value = await signJSON(
        { iat: now, exp: now + 60 * 60 * 1000 },
        env.COOKIE_HMAC_SECRET as string,
    );
    sessionCookie = `admin_session=${value}`;
});

function authed(init: RequestInit = {}): RequestInit {
    return {
        ...init,
        headers: {
            ...(init.headers as Record<string, string> | undefined),
            cookie: sessionCookie,
            host: 'localhost',
        },
    };
}

async function createPair(): Promise<{
    browseToken: string;
    downloadToken: string;
}> {
    const form = new FormData();
    form.set('name', 'Q1 deck');
    form.set('prefix', 'decks/q1/');
    form.set('notes', 'for review');
    form.set('preset', '1w');
    const res = await SELF.fetch(
        `${BASE}/_admin/links`,
        authed({ method: 'POST', body: form }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();

    // Extract tokens from data-copy attributes. There should be two unique tokens.
    const matches = Array.from(
        html.matchAll(/data-copy="https:\/\/([a-z0-9]{10})\./g),
    );
    const tokens = Array.from(new Set(matches.map(m => m[1] as string)));
    expect(tokens).toHaveLength(2);

    const [a, b] = tokens;
    const linkA = await getLink(env.LINKS, a);
    const linkB = await getLink(env.LINKS, b);
    expect(linkA).not.toBeNull();
    expect(linkB).not.toBeNull();
    const browseToken = (linkA?.linkType ?? 'browse') === 'browse' ? a : b;
    const downloadToken = browseToken === a ? b : a;
    return { browseToken, downloadToken };
}

describe('link pair create', () => {
    it('POST /_admin/links writes two cross-linked KV records', async () => {
        const { browseToken, downloadToken } = await createPair();
        const browse = await getLink(env.LINKS, browseToken);
        const download = await getLink(env.LINKS, downloadToken);

        expect(browse?.linkType).toBe('browse');
        expect(download?.linkType).toBe('download');
        expect(browse?.pairedToken).toBe(downloadToken);
        expect(download?.pairedToken).toBe(browseToken);
        expect(browse?.prefix).toBe(download?.prefix);
        expect(browse?.name).toBe(download?.name);
        expect(browse?.expiresAt).toBe(download?.expiresAt);
    });

    it('dashboard fragment lists one row per pair', async () => {
        await createPair();
        const res = await SELF.fetch(
            `${BASE}/_admin/links`,
            authed({ method: 'GET' }),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        const rows = (html.match(/<tr id="link-/g) ?? []).length;
        expect(rows).toBe(1);
        // both URL labels appear
        expect(html).toContain('View link');
        expect(html).toContain('Download link');
    });
});

describe('link pair mutate', () => {
    it('extend updates both halves', async () => {
        const { browseToken, downloadToken } = await createPair();
        const form = new FormData();
        form.set('preset', '1d');
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}/extend`,
            authed({ method: 'POST', body: form }),
        );
        expect(res.status).toBe(200);
        const browse = await getLink(env.LINKS, browseToken);
        const download = await getLink(env.LINKS, downloadToken);
        // 1d ≈ now+86400000, browse and download should match
        expect(browse?.expiresAt).toBe(download?.expiresAt);
    });

    it('revoke marks both halves revoked', async () => {
        const { browseToken, downloadToken } = await createPair();
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}/revoke`,
            authed({ method: 'POST' }),
        );
        expect(res.status).toBe(200);
        const browse = await getLink(env.LINKS, browseToken);
        const download = await getLink(env.LINKS, downloadToken);
        expect(browse?.revokedAt).toBeTypeOf('number');
        expect(download?.revokedAt).toBeTypeOf('number');
    });

    it('PATCH renames both halves', async () => {
        const { browseToken, downloadToken } = await createPair();
        const form = new FormData();
        form.set('name', 'Renamed deck');
        form.set('prefix', 'decks/q1/');
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}`,
            authed({ method: 'PATCH', body: form }),
        );
        expect(res.status).toBe(200);
        const browse = await getLink(env.LINKS, browseToken);
        const download = await getLink(env.LINKS, downloadToken);
        expect(browse?.name).toBe('Renamed deck');
        expect(download?.name).toBe('Renamed deck');
    });

    it('DELETE removes both halves', async () => {
        const { browseToken, downloadToken } = await createPair();
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}`,
            authed({ method: 'DELETE' }),
        );
        expect(res.status).toBe(200);
        expect(await getLink(env.LINKS, browseToken)).toBeNull();
        expect(await getLink(env.LINKS, downloadToken)).toBeNull();
    });

    it('mutating the surviving half after manual delete does not crash', async () => {
        const { browseToken, downloadToken } = await createPair();
        // Simulate orphan: delete only the download half via raw KV.
        await env.LINKS.delete(`link:${downloadToken}`);
        const form = new FormData();
        form.set('preset', '1d');
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}/extend`,
            authed({ method: 'POST', body: form }),
        );
        expect(res.status).toBe(200);
        const browse = await getLink(env.LINKS, browseToken);
        expect(browse?.revokedAt).toBeUndefined();
    });
});

describe('legacy unpaired link', () => {
    it('appears as browse-only row with "Create download link" button', async () => {
        const legacy: ShareLink = {
            token: 'legacyabcd',
            name: 'Legacy',
            prefix: 'legacy/',
            createdAt: Date.now(),
            expiresAt: Date.now() + 86_400_000,
            viewCount: 0,
        };
        await putLink(env.LINKS, legacy);

        const res = await SELF.fetch(
            `${BASE}/_admin/links`,
            authed({ method: 'GET' }),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Create download link');
        expect(html).toContain('legacyabcd');
    });

    it('POST /:token/pair creates a download partner', async () => {
        const legacy: ShareLink = {
            token: 'legacyabcd',
            name: 'Legacy',
            prefix: 'legacy/',
            createdAt: Date.now(),
            expiresAt: Date.now() + 86_400_000,
            viewCount: 0,
        };
        await putLink(env.LINKS, legacy);
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${legacy.token}/pair`,
            authed({ method: 'POST' }),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Download link');

        const browse = await getLink(env.LINKS, legacy.token);
        expect(browse?.linkType).toBe('browse');
        expect(browse?.pairedToken).toBeTruthy();
        const download = await getLink(
            env.LINKS,
            browse!.pairedToken as string,
        );
        expect(download?.linkType).toBe('download');
        expect(download?.prefix).toBe(legacy.prefix);
        expect(download?.expiresAt).toBe(legacy.expiresAt);
    });

    it('POST /:token/pair refuses if already paired', async () => {
        const { browseToken } = await createPair();
        const res = await SELF.fetch(
            `${BASE}/_admin/links/${browseToken}/pair`,
            authed({ method: 'POST' }),
        );
        expect(res.status).toBe(409);
    });
});
