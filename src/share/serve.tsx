import type { Context } from 'hono';
import type { ShareEnv, ShareLink } from '../types';
import { mimeFor, isHtmlMime } from '../lib/mime';
import { parseRange } from '../lib/range';
import { putLink } from '../kv/links';
import { ListingPage, type ListingEntry } from './views/listing';

export const HTML_EDGE_TTL = 60;
export const ASSET_EDGE_TTL = 3600;

/**
 * Resolve a request path to an R2 key under the share's prefix.
 *
 * - "/" → <prefix>/index.html
 * - "/foo/" → <prefix>/foo/index.html
 * - else → <prefix>/<path> (1:1)
 *
 * Strict: no .html-extension fallback, no SPA fallback.
 */
export function resolveKey(prefix: string, path: string): string {
    const p = prefix.replace(/\/+$/, '');
    const inner = path.startsWith('/') ? path.slice(1) : path;

    let target: string;
    if (inner === '') target = 'index.html';
    else if (inner.endsWith('/')) target = `${inner}index.html`;
    else target = inner;

    return p ? `${p}/${target}` : target;
}

/** Compute the R2 list prefix for a share path. Path must end in `/` or be `/`. */
export function listingPrefix(sharePrefix: string, path: string): string {
    const p = sharePrefix.replace(/\/+$/, '');
    const inner = path === '/' ? '' : path.replace(/^\/+/, '');
    if (!p && !inner) return '';
    if (!p) return inner;
    if (!inner) return `${p}/`;
    return `${p}/${inner}`;
}

function plainTextResponse(status: number, body: string): Response {
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

/** Build a fresh response from R2 (or null if missing). Range-aware. */
export async function fetchFromR2(
    bucket: R2Bucket,
    key: string,
    rangeHeader: string | null,
): Promise<Response | null> {
    let getOptions: R2GetOptions = {};
    if (rangeHeader) {
        const range = parseRange(rangeHeader);
        if (range) getOptions = { range };
    }

    const obj = await bucket.get(key, getOptions);
    if (!obj) return null;

    const mime = mimeFor(key);
    const headers = new Headers();
    headers.set('Content-Type', mime);
    headers.set('Accept-Ranges', 'bytes');
    if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
    if (obj.uploaded) headers.set('Last-Modified', obj.uploaded.toUTCString());

    const total = obj.size;
    const range = obj.range;

    if (range && rangeHeader) {
        let offset: number;
        let length: number;
        if ('suffix' in range) {
            length = range.suffix;
            offset = Math.max(0, total - length);
        } else {
            offset = range.offset ?? 0;
            length = range.length ?? Math.max(0, total - offset);
        }
        const end = Math.max(offset, offset + length - 1);
        headers.set('Content-Range', `bytes ${offset}-${end}/${total}`);
        headers.set('Content-Length', String(length));
        return new Response(obj.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(total));
    return new Response(obj.body, { status: 200, headers });
}

function withEdgeCacheControl(res: Response, edgeMaxAgeSeconds: number): Response {
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', `public, max-age=${edgeMaxAgeSeconds}`);
    const existingVary = headers.get('Vary');
    headers.set('Vary', existingVary ? `${existingVary}, Range` : 'Range');
    return new Response(res.body, { status: res.status, headers });
}

function withBrowserNoStore(res: Response): Response {
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
}

function isDirectoryRequest(path: string): boolean {
    return path === '/' || path.endsWith('/');
}

function parentPath(path: string): string | undefined {
    if (path === '/' || path === '') return undefined;
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const slash = trimmed.lastIndexOf('/');
    if (slash <= 0) return '/';
    return trimmed.slice(0, slash + 1);
}

async function buildListing(
    bucket: R2Bucket,
    sharePrefix: string,
    path: string,
): Promise<ListingEntry[] | null> {
    const lp = listingPrefix(sharePrefix, path);
    // Always end the listing prefix with `/` so delimiter scoping is correct
    // unless we're at the very root (empty prefix).
    const scoped = lp === '' ? '' : lp.endsWith('/') ? lp : `${lp}/`;

    const res = await bucket.list({
        prefix: scoped,
        delimiter: '/',
        limit: 1000,
    });

    const folders = (res.delimitedPrefixes ?? []).map((full) => {
        const name = full.slice(scoped.length).replace(/\/+$/, '');
        const href = `${path}${name}/`.replace(/^\/+/, '/');
        return { name, href, kind: 'folder' as const };
    });

    const files = res.objects
        .filter((o) => o.key !== scoped) // ignore zero-byte directory marker if any
        .map((o) => {
            const name = o.key.slice(scoped.length);
            const href = `${path}${name}`.replace(/^\/+/, '/');
            return { name, href, kind: 'file' as const, size: o.size };
        });

    if (folders.length === 0 && files.length === 0) return null;

    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...files];
}

/**
 * Serve a request for a known-valid share. Handles: cache lookup → R2 fetch
 * → directory listing fallback → cache write → view counter.
 */
export async function serveShare(
    c: Context<ShareEnv>,
    link: ShareLink,
    ctx: ExecutionContext,
): Promise<Response> {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const key = resolveKey(link.prefix, path);
    const rangeHeader = c.req.header('Range') ?? null;

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), {
        method: 'GET',
        headers: rangeHeader ? { Range: rangeHeader } : {},
    });

    const cached = await cache.match(cacheKey);
    if (cached) {
        countViewIfHtml(c.env, link, cached, ctx);
        return withBrowserNoStore(cached);
    }

    const r2res = await fetchFromR2(c.env.BUCKET, key, rangeHeader);

    if (!r2res) {
        // Directory listing fallback.
        if (isDirectoryRequest(path)) {
            const entries = await buildListing(c.env.BUCKET, link.prefix, path);
            if (entries) {
                const listingHtml = await c.html(
                    <ListingPage path={path} parentHref={parentPath(path)} entries={entries} />,
                );
                const ttl = HTML_EDGE_TTL;
                const [edgeBody, browserBody] = listingHtml.body!.tee();
                const cacheable = withEdgeCacheControl(
                    new Response(edgeBody, { status: 200, headers: listingHtml.headers }),
                    ttl,
                );
                ctx.waitUntil(cache.put(cacheKey, cacheable));
                const browserRes = withBrowserNoStore(
                    new Response(browserBody, { status: 200, headers: listingHtml.headers }),
                );
                countViewIfHtml(c.env, link, browserRes, ctx);
                return browserRes;
            }
        }
        return plainTextResponse(404, 'not found');
    }

    const ttl = isHtmlMime(r2res.headers.get('Content-Type') ?? '')
        ? HTML_EDGE_TTL
        : ASSET_EDGE_TTL;

    const [edgeBody, browserBody] = r2res.body!.tee();

    const cacheableRes = withEdgeCacheControl(
        new Response(edgeBody, { status: r2res.status, headers: r2res.headers }),
        ttl,
    );
    if (r2res.status === 200 || r2res.status === 206) {
        ctx.waitUntil(cache.put(cacheKey, cacheableRes));
    }

    const browserRes = withBrowserNoStore(
        new Response(browserBody, { status: r2res.status, headers: r2res.headers }),
    );
    countViewIfHtml(c.env, link, browserRes, ctx);
    return browserRes;
}

function countViewIfHtml(
    env: ShareEnv['Bindings'],
    link: ShareLink,
    res: Response,
    ctx: ExecutionContext,
): void {
    const ct = res.headers.get('Content-Type') ?? '';
    if (!isHtmlMime(ct)) return;
    if (res.status !== 200) return;
    ctx.waitUntil(
        putLink(env.LINKS, {
            ...link,
            viewCount: link.viewCount + 1,
            lastAccessedAt: Date.now(),
        }).catch(() => {
            // KV write rate-limit etc — under-count is acceptable.
        }),
    );
}
