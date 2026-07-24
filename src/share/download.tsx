import type { Context } from 'hono';
import type { ShareEnv, ShareLink } from '../types';
import { putLink } from '../kv/links';
import { streamFolderZip, streamObject } from '../admin/files';
import { DownloadPage } from './views/download';
import { log } from '../lib/log';

const DOWNLOAD_PATH = '/__download';

type Target =
    | { kind: 'file'; key: string; filename: string }
    | { kind: 'folder'; prefix: string; folderName: string };

/**
 * Resolve `link.prefix` to a download target. Trailing `/` is treated as a
 * folder; otherwise `bucket.head` decides between file and folder. Result is
 * stable within a single request so the landing page and the download action
 * agree on labels.
 */
async function resolveTarget(
    bucket: R2Bucket,
    prefix: string,
): Promise<Target | null> {
    const trimmed = prefix.replace(/^\/+/, '');
    if (trimmed.endsWith('/')) {
        const folderName =
            trimmed.replace(/\/+$/, '').split('/').pop() || 'archive';
        return { kind: 'folder', prefix: trimmed, folderName };
    }
    const head = await bucket.head(trimmed);
    if (head) {
        const filename = trimmed.split('/').pop() || 'download';
        return { kind: 'file', key: trimmed, filename };
    }
    // No exact-object hit — fall back to treating it as a folder prefix.
    const folderPrefix = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    const folderName =
        folderPrefix.replace(/\/+$/, '').split('/').pop() || 'archive';
    return { kind: 'folder', prefix: folderPrefix, folderName };
}

function targetLabel(target: Target): string {
    if (target.kind === 'file') return target.filename;
    return `${target.folderName}/`;
}

/**
 * Serve the download-type share entrypoint: landing page at `/`, file/zip
 * stream at `/__download`. Caller has already gated on link validity and
 * Turnstile cookie via existing share middleware.
 */
export async function serveDownload(
    c: Context<ShareEnv>,
    link: ShareLink,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const isAction = path === DOWNLOAD_PATH;
    const isHead = c.req.method === 'HEAD';

    const target = await resolveTarget(c.env.BUCKET, link.prefix);
    if (!target) {
        return c.html(
            <DownloadPage
                name={link.name || link.token}
                target={link.prefix}
                error="Nothing to download — the file or folder is missing."
                actionHref={DOWNLOAD_PATH}
            />,
            404,
            { 'Cache-Control': 'no-store' },
        );
    }

    if (!isAction) {
        // Landing page (and any other share path) renders the download UI.
        return c.html(
            <DownloadPage
                name={link.name || link.token}
                target={targetLabel(target)}
                actionHref={DOWNLOAD_PATH}
            />,
            200,
            { 'Cache-Control': 'no-store' },
        );
    }

    try {
        const res =
            target.kind === 'file'
                ? await streamObject(c.env.BUCKET, target.key, target.filename)
                : await streamFolderZip(c.env.BUCKET, target.prefix);
        log({
            event: 'share.download',
            token: link.token,
            kind: target.kind,
            prefix: link.prefix,
        });
        bumpDownloadCount(c.env, link, ctx);
        if (isHead) {
            return new Response(null, {
                status: res.status,
                headers: res.headers,
            });
        }
        return res;
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Download failed.';
        log({
            event: 'share.download_fail',
            token: link.token,
            error: message,
        });
        return c.html(
            <DownloadPage
                name={link.name || link.token}
                target={targetLabel(target)}
                error={message}
                actionHref={DOWNLOAD_PATH}
            />,
            400,
            { 'Cache-Control': 'no-store' },
        );
    }
}

function bumpDownloadCount(
    env: ShareEnv['Bindings'],
    link: ShareLink,
    ctx: Pick<ExecutionContext, 'waitUntil'>,
): void {
    ctx.waitUntil(
        putLink(env.LINKS, {
            ...link,
            downloadCount: (link.downloadCount ?? 0) + 1,
            lastAccessedAt: Date.now(),
        }).catch(() => {
            // KV write rate-limit etc — under-count is acceptable.
        }),
    );
}
