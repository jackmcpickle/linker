import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signJSON } from '../../lib/cookie';

let sessionCookie = '';

async function emptyBucket() {
    let cursor: string | undefined;
    do {
        const res: R2Objects = await env.BUCKET.list({ limit: 1000, cursor });
        if (res.objects.length > 0) {
            await env.BUCKET.delete(res.objects.map(o => o.key));
        }
        cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
}

afterEach(emptyBucket);

async function makeCookie(): Promise<string> {
    const now = Date.now();
    const value = await signJSON(
        { iat: now, exp: now + 60 * 60 * 1000 },
        env.COOKIE_HMAC_SECRET as string,
    );
    return `admin_session=${value}`;
}

const BASE = 'http://localhost';

function authed(init: RequestInit = {}): RequestInit {
    return {
        ...init,
        headers: {
            ...(init.headers || {}),
            cookie: sessionCookie,
            host: 'localhost',
        },
    };
}

beforeAll(async () => {
    sessionCookie = await makeCookie();
});

describe('multipart upload (HTTP)', () => {
    it('rejects unauthenticated init with a redirect', async () => {
        const form = new FormData();
        form.set('prefix', 'docs');
        form.set('name', 'a.txt');
        form.set('size', '10');
        form.set('contentType', 'text/plain');
        const res = await SELF.fetch(`${BASE}/_admin/files/multipart/init`, {
            method: 'POST',
            body: form,
            headers: { host: 'localhost' },
            redirect: 'manual',
        });
        // requireAuth issues a 303 redirect to /_admin
        expect([301, 302, 303, 307, 308]).toContain(res.status);
    });

    it('happy path: init → 2 parts → complete', async () => {
        const form = new FormData();
        form.set('prefix', 'docs');
        form.set('name', 'parts.bin');
        form.set('size', String(5_242_880 + 1024));
        form.set('contentType', 'application/octet-stream');

        const initRes = await SELF.fetch(
            `${BASE}/_admin/files/multipart/init`,
            authed({ method: 'POST', body: form }),
        );
        expect(initRes.status).toBe(200);
        const init = (await initRes.json()) as {
            uploadId: string | null;
            key: string;
            partSize: number;
            overwriting: boolean;
        };
        expect(init.uploadId).toBeTruthy();
        expect(init.key).toBe('docs/parts.bin');

        const partA = new Uint8Array(5_242_880).fill(1);
        const partB = new Uint8Array(1024).fill(2);
        const p1Res = await SELF.fetch(
            `${BASE}/_admin/files/multipart/part?uploadId=${encodeURIComponent(init.uploadId!)}&key=${encodeURIComponent(init.key)}&part=1`,
            authed({ method: 'PUT', body: partA }),
        );
        expect(p1Res.status).toBe(200);
        const p1 = (await p1Res.json()) as {
            partNumber: number;
            etag: string;
        };
        const p2Res = await SELF.fetch(
            `${BASE}/_admin/files/multipart/part?uploadId=${encodeURIComponent(init.uploadId!)}&key=${encodeURIComponent(init.key)}&part=2`,
            authed({ method: 'PUT', body: partB }),
        );
        const p2 = (await p2Res.json()) as {
            partNumber: number;
            etag: string;
        };

        const completeRes = await SELF.fetch(
            `${BASE}/_admin/files/multipart/complete`,
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uploadId: init.uploadId,
                    key: init.key,
                    parts: [p1, p2],
                }),
            }),
        );
        expect(completeRes.status).toBe(200);
        const html = await completeRes.text();
        expect(html).toContain('parts.bin');

        const obj = await env.BUCKET.get('docs/parts.bin');
        expect(obj).not.toBeNull();
        expect(obj!.size).toBe(5_242_880 + 1024);
    });

    it('abort makes complete fail', async () => {
        const form = new FormData();
        form.set('prefix', 'docs');
        form.set('name', 'tmp.bin');
        form.set('size', '5242880');
        form.set('contentType', 'application/octet-stream');
        const initRes = await SELF.fetch(
            `${BASE}/_admin/files/multipart/init`,
            authed({ method: 'POST', body: form }),
        );
        const init = (await initRes.json()) as {
            uploadId: string;
            key: string;
        };
        const partRes = await SELF.fetch(
            `${BASE}/_admin/files/multipart/part?uploadId=${encodeURIComponent(init.uploadId)}&key=${encodeURIComponent(init.key)}&part=1`,
            authed({
                method: 'PUT',
                body: new Uint8Array(5_242_880),
            }),
        );
        const part = await partRes.json();
        await SELF.fetch(
            `${BASE}/_admin/files/multipart/abort`,
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uploadId: init.uploadId,
                    key: init.key,
                }),
            }),
        );
        const completeRes = await SELF.fetch(
            `${BASE}/_admin/files/multipart/complete`,
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uploadId: init.uploadId,
                    key: init.key,
                    parts: [part],
                }),
            }),
        );
        expect(completeRes.status).toBeGreaterThanOrEqual(400);
    });
});

describe('rename (HTTP)', () => {
    it('PATCH /_admin/files/object renames a file', async () => {
        await env.BUCKET.put('docs/old.txt', 'hi');
        const form = new FormData();
        form.set('key', 'docs/old.txt');
        form.set('newName', 'new.txt');
        const res = await SELF.fetch(
            `${BASE}/_admin/files/object`,
            authed({ method: 'PATCH', body: form }),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('new.txt');
        expect(await env.BUCKET.head('docs/old.txt')).toBeNull();
        expect(await env.BUCKET.head('docs/new.txt')).not.toBeNull();
    });

    it('PATCH folder happy path', async () => {
        await env.BUCKET.put('a/x.txt', 'x');
        await env.BUCKET.put('a/y.txt', 'y');
        const form = new FormData();
        form.set('prefix', 'a/');
        form.set('newName', 'b');
        const res = await SELF.fetch(
            `${BASE}/_admin/files/folder`,
            authed({ method: 'PATCH', body: form }),
        );
        expect(res.status).toBe(200);
        expect(await env.BUCKET.head('a/x.txt')).toBeNull();
        expect(await env.BUCKET.head('b/x.txt')).not.toBeNull();
    });

    it('PATCH folder refuses when destination exists', async () => {
        await env.BUCKET.put('a/x.txt', 'x');
        await env.BUCKET.put('b/y.txt', 'y');
        const form = new FormData();
        form.set('prefix', 'a/');
        form.set('newName', 'b');
        const res = await SELF.fetch(
            `${BASE}/_admin/files/folder`,
            authed({ method: 'PATCH', body: form }),
        );
        // toastError → 400
        expect(res.status).toBe(400);
        const body = await res.text();
        expect(body.toLowerCase()).toContain('already exists');
        // source intact
        expect(await env.BUCKET.head('a/x.txt')).not.toBeNull();
    });

    it('rename requires auth', async () => {
        const form = new FormData();
        form.set('key', 'docs/anything.txt');
        form.set('newName', 'other.txt');
        const res = await SELF.fetch(`${BASE}/_admin/files/object`, {
            method: 'PATCH',
            body: form,
            headers: { host: 'localhost' },
            redirect: 'manual',
        });
        expect([301, 302, 303, 307, 308]).toContain(res.status);
    });
});
