import type { Context } from "hono";
import type { ShareEnv, ShareLink } from "../types";
import { mimeFor, isHtmlMime } from "../lib/mime";
import { parseRange } from "../lib/range";
import { putLink } from "../kv/links";

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
  const p = prefix.replace(/\/+$/, "");
  const inner = path.startsWith("/") ? path.slice(1) : path;

  let target: string;
  if (inner === "") target = "index.html";
  else if (inner.endsWith("/")) target = `${inner}index.html`;
  else target = inner;

  return p ? `${p}/${target}` : target;
}

function plainTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Build a fresh response from R2 (or a 404). Range-aware. */
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
  headers.set("Content-Type", mime);
  headers.set("Accept-Ranges", "bytes");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  if (obj.uploaded) headers.set("Last-Modified", obj.uploaded.toUTCString());

  // R2 returns the actually-served range in `obj.range` for partial gets.
  const total = obj.size;
  const range = obj.range;

  if (range && rangeHeader) {
    let offset: number;
    let length: number;
    if ("suffix" in range) {
      length = range.suffix;
      offset = Math.max(0, total - length);
    } else {
      offset = range.offset ?? 0;
      length = range.length ?? Math.max(0, total - offset);
    }
    const end = Math.max(offset, offset + length - 1);
    headers.set("Content-Range", `bytes ${offset}-${end}/${total}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(total));
  return new Response(obj.body, { status: 200, headers });
}

function withEdgeCacheControl(
  res: Response,
  edgeMaxAgeSeconds: number,
  rangeHeader: string | null,
): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", `public, max-age=${edgeMaxAgeSeconds}`);
  // Vary on Range so partial responses don't poison full responses (and v.v.).
  const existingVary = headers.get("Vary");
  headers.set("Vary", existingVary ? `${existingVary}, Range` : "Range");
  void rangeHeader; // accepted via Vary, header itself not echoed
  return new Response(res.body, { status: res.status, headers });
}

function withBrowserNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

/**
 * Serve a request for a known-valid share. Handles: path resolution → cache lookup
 * → R2 fetch → cache write → view counter (best-effort).
 */
export async function serveShare(
  c: Context<ShareEnv>,
  link: ShareLink,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(c.req.url);
  const key = resolveKey(link.prefix, url.pathname);
  const rangeHeader = c.req.header("Range") ?? null;

  const cache = caches.default;
  // Use the request URL directly as cache key (host included → per-share isolation).
  const cacheKey = new Request(url.toString(), {
    method: "GET",
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  const cached = await cache.match(cacheKey);
  if (cached) {
    countViewIfHtml(c.env, link, cached, ctx);
    return withBrowserNoStore(cached);
  }

  const r2res = await fetchFromR2(c.env.BUCKET, key, rangeHeader);
  if (!r2res) {
    // Return a marker so directory-listing fallback (stage 10) can intercept.
    return plainTextResponse(404, "not found");
  }

  const ttl = isHtmlMime(r2res.headers.get("Content-Type") ?? "")
    ? HTML_EDGE_TTL
    : ASSET_EDGE_TTL;

  // Build edge-cacheable + browser-facing variants from a single R2 stream.
  // R2 response body is a ReadableStream — `tee()` gives us two consumers.
  const [edgeBody, browserBody] = r2res.body!.tee();

  const edgeRes = new Response(edgeBody, { status: r2res.status, headers: r2res.headers });
  const cacheableRes = withEdgeCacheControl(edgeRes, ttl, rangeHeader);
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
  env: ShareEnv["Bindings"],
  link: ShareLink,
  res: Response,
  ctx: ExecutionContext,
): void {
  const ct = res.headers.get("Content-Type") ?? "";
  if (!isHtmlMime(ct)) return;
  if (res.status !== 200) return;
  ctx.waitUntil(
    putLink(env.LINKS, {
      ...link,
      viewCount: link.viewCount + 1,
      lastAccessedAt: Date.now(),
    }).catch(() => {
      // KV write may rate-limit; under-count is acceptable.
    }),
  );
}
