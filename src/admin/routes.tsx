import { Hono } from 'hono';
import type { Env, ShareLink } from '../types';
import { LoginPage } from './views/login';
import { DashboardPage, LinkList } from './views/dashboard';
import { LinkRow } from './views/link-row';
import {
    clearSessionCookie,
    clientIp,
    isAuthed,
    requireAuth,
    setSessionCookie,
} from './auth';
import {
    checkLoginThrottle,
    clearLoginFailures,
    recordLoginFailure,
} from '../lib/throttle';
import { verifyTurnstile } from '../lib/turnstile';
import { getLink, listLinks, putLink, deleteLink } from '../kv/links';
import { generateToken, isValidToken } from '../lib/nanoid';
import { presetMs } from '../lib/expiry';
import { Suggestions } from './views/suggestions';
import { log } from '../lib/log';
import { toastError, withToast } from './lib/toast';
import { FilesPage } from './views/files-page';
import { FileList, listUrl } from './views/file-list';
import {
    FileRowEdit,
    FileRowStatic,
    FolderRowEdit,
    FolderRowStatic,
} from './views/file-row-edit';
import {
    abortMultipart,
    completeMultipart,
    createFolder,
    deletePrefix,
    initMultipart,
    listAt,
    parentOf,
    parsePrefix,
    popCursor,
    pushCursor,
    renameFile,
    renameFolder,
    uploadPart,
    validateName,
    type UploadedPart,
} from './files';

const admin = new Hono<Env>();

// ---------- static asset passthrough ----------
admin.get('/login.js', async c => c.env.ASSETS.fetch(c.req.raw));
admin.get('/admin.js', async c => c.env.ASSETS.fetch(c.req.raw));
admin.get('/style.css', async c => c.env.ASSETS.fetch(c.req.raw));
admin.get('/favicon.ico', async c => c.env.ASSETS.fetch(c.req.raw));

// ---------- public routes (login) ----------
admin.get('/', c => c.redirect('/_admin', 303));

function isSafePrefix(s: string): boolean {
    if (!s || s.includes('..')) return false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 32 || c === 0x5c) return false;
    }
    return true;
}

admin.get('/_admin', async c => {
    if (await isAuthed(c)) {
        const links = await listLinks(c.env.LINKS);
        const candidate = normalizePrefix(c.req.query('prefix') ?? '');
        const defaultPrefix = isSafePrefix(candidate) ? candidate : undefined;
        return c.html(
            <DashboardPage
                links={links}
                shareDomain={c.env.SHARE_DOMAIN}
                defaultPrefix={defaultPrefix}
            />,
        );
    }
    return c.html(<LoginPage turnstileSiteKey={c.env.TURNSTILE_SITE_KEY} />);
});

admin.post('/_admin/login', async c => {
    const ip = clientIp(c);
    const now = Date.now();

    const throttle = await checkLoginThrottle(c.env.THROTTLE, ip, now);
    if (!throttle.allowed) {
        return c.html(
            <LoginPage
                turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
                lockedUntil={throttle.lockedUntil}
            />,
            429,
        );
    }

    const form = await c.req.formData();
    const password = String(form.get('password') ?? '');
    const tsToken = String(form.get('cf-turnstile-response') ?? '');

    const ts = await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET_KEY, ip);
    if (!ts.ok) {
        await recordLoginFailure(c.env.THROTTLE, ip, now);
        log({ event: 'admin.login.turnstile_fail', errors: ts.errors });
        return c.html(
            <LoginPage
                turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
                error="Verification failed. Try again."
            />,
            400,
        );
    }

    if (!constantTimeEqual(password, c.env.ADMIN_PASSWORD)) {
        const recorded = await recordLoginFailure(c.env.THROTTLE, ip, now);
        log({ event: 'admin.login.password_fail', locked: !recorded.allowed });
        if (!recorded.allowed) {
            return c.html(
                <LoginPage
                    turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
                    lockedUntil={recorded.lockedUntil}
                />,
                429,
            );
        }
        return c.html(
            <LoginPage
                turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
                error="Incorrect password."
            />,
            401,
        );
    }

    await clearLoginFailures(c.env.THROTTLE, ip);
    await setSessionCookie(c);
    log({ event: 'admin.login.ok' });
    return c.redirect('/_admin', 303);
});

admin.post('/_admin/logout', async c => {
    clearSessionCookie(c);
    return c.redirect('/_admin', 303);
});

// ---------- authed routes ----------
admin.use('/_admin/*', requireAuth);

// list fragment (HTMX target after mutations)
admin.get('/_admin/links', async c => {
    const links = await listLinks(c.env.LINKS);
    return c.html(
        <LinkList
            links={links}
            shareDomain={c.env.SHARE_DOMAIN}
        />,
    );
});

// create
admin.post('/_admin/links', async c => {
    const form = await c.req.formData();
    const name = String(form.get('name') ?? '').trim();
    const prefix = normalizePrefix(String(form.get('prefix') ?? ''));
    const notes = String(form.get('notes') ?? '').trim() || undefined;
    const presetId = String(form.get('preset') ?? '');
    const ms = presetMs(presetId);

    if (!name || !prefix || ms === null) {
        return toastError(c, 'Invalid name, folder, or expiry.', 400);
    }

    const now = Date.now();
    const link: ShareLink = {
        token: generateToken(),
        name,
        notes,
        prefix,
        createdAt: now,
        expiresAt: now + ms,
        viewCount: 0,
    };
    await putLink(c.env.LINKS, link);
    log({
        event: 'admin.link.create',
        token: link.token,
        prefix: link.prefix,
        expiresAt: link.expiresAt,
    });

    // KV list is eventually consistent — splice the new link in so it shows
    // up immediately, even if `listLinks` hasn't seen the put yet.
    const links = await listLinks(c.env.LINKS);
    if (!links.some(l => l.token === link.token)) {
        links.unshift(link);
    }
    return c.html(
        withToast(
            <LinkList
                links={links}
                shareDomain={c.env.SHARE_DOMAIN}
            />,
            'success',
            'Link created.',
        ),
    );
});

// single row (used by Cancel on edit form)
admin.get('/_admin/links/:token', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    const link = await getLink(c.env.LINKS, token);
    if (!link) return toastError(c, 'Link not found.', 404);
    return c.html(
        <LinkRow
            link={link}
            shareDomain={c.env.SHARE_DOMAIN}
        />,
    );
});

// edit form (inline)
admin.get('/_admin/links/:token/edit', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    const link = await getLink(c.env.LINKS, token);
    if (!link) return toastError(c, 'Link not found.', 404);
    return c.html(
        <LinkRow
            link={link}
            shareDomain={c.env.SHARE_DOMAIN}
            mode="edit"
        />,
    );
});

// update name/prefix/notes
admin.patch('/_admin/links/:token', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    const link = await getLink(c.env.LINKS, token);
    if (!link) return toastError(c, 'Link not found.', 404);

    const form = await c.req.formData();
    const name = String(form.get('name') ?? '').trim();
    const prefix = normalizePrefix(String(form.get('prefix') ?? ''));
    const notes = String(form.get('notes') ?? '').trim() || undefined;

    if (!name || !prefix)
        return toastError(c, 'Name and folder required.', 400);

    const updated: ShareLink = { ...link, name, prefix, notes };
    await putLink(c.env.LINKS, updated);
    return c.html(
        withToast(
            <LinkRow
                link={updated}
                shareDomain={c.env.SHARE_DOMAIN}
            />,
            'success',
            'Link updated.',
        ),
    );
});

// extend expiry — sets new absolute expiresAt = now + preset (un-revokes if revoked)
admin.post('/_admin/links/:token/extend', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    const link = await getLink(c.env.LINKS, token);
    if (!link) return toastError(c, 'Link not found.', 404);

    const form = await c.req.formData();
    const presetId = String(form.get('preset') ?? '');
    const ms = presetMs(presetId);
    if (ms === null) return toastError(c, 'Invalid expiry preset.', 400);

    const now = Date.now();
    const updated: ShareLink = {
        ...link,
        expiresAt: now + ms,
        revokedAt: undefined,
    };
    await putLink(c.env.LINKS, updated);
    log({
        event: 'admin.link.extend',
        token,
        preset: presetId,
        expiresAt: updated.expiresAt,
    });
    return c.html(
        withToast(
            <LinkRow
                link={updated}
                shareDomain={c.env.SHARE_DOMAIN}
            />,
            'success',
            `Extended to ${presetId}.`,
        ),
    );
});

// revoke
admin.post('/_admin/links/:token/revoke', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    const link = await getLink(c.env.LINKS, token);
    if (!link) return toastError(c, 'Link not found.', 404);
    const updated: ShareLink = { ...link, revokedAt: Date.now() };
    await putLink(c.env.LINKS, updated);
    log({ event: 'admin.link.revoke', token });
    return c.html(
        withToast(
            <LinkRow
                link={updated}
                shareDomain={c.env.SHARE_DOMAIN}
            />,
            'success',
            'Link revoked.',
        ),
    );
});

// hard delete — return empty so HTMX outerHTML swap removes the row
admin.delete('/_admin/links/:token', async c => {
    const token = c.req.param('token');
    if (!isValidToken(token)) return toastError(c, 'Link not found.', 404);
    await deleteLink(c.env.LINKS, token);
    log({ event: 'admin.link.delete', token });
    return c.html(withToast('', 'success', 'Link deleted.'));
});

// typeahead — bucket.list({ prefix, delimiter: '/' })
admin.get('/_admin/prefixes', async c => {
    const q = (c.req.query('prefix') ?? '').trim();
    if (!q)
        return c.html(
            <Suggestions
                folders={[]}
                files={[]}
                q=""
            />,
        );

    const res = await c.env.BUCKET.list({
        prefix: q,
        delimiter: '/',
        limit: 50,
    });

    const folders = (res.delimitedPrefixes ?? []).slice(0, 12);
    const files = res.objects
        .map(o => o.key)
        .filter(k => k !== q)
        .slice(0, 12);

    return c.html(
        <Suggestions
            folders={folders}
            files={files}
            q={q}
        />,
    );
});

// ---------- file browser ----------

type FilesQuery = {
    prefix: string;
    cursor?: string;
    prev: string;
};

function readFilesQuery(c: {
    req: { query: (k: string) => string | undefined };
}): FilesQuery {
    const rawPrefix = c.req.query('prefix') ?? '';
    let prefix = '';
    try {
        prefix = parsePrefix(rawPrefix);
    } catch {
        prefix = '';
    }
    const cursor = c.req.query('cursor') || undefined;
    const prev = c.req.query('prev') ?? '';
    return { prefix, cursor, prev };
}

async function buildFileListProps(
    bucket: R2Bucket,
    prefix: string,
    cursor: string | undefined,
    prev: string,
) {
    const page = await listAt(bucket, prefix, cursor);

    let prevHref: string | undefined;
    let nextHref: string | undefined;

    if (prev) {
        const popped = popCursor(prev);
        prevHref = listUrl(
            prefix,
            popped.cursor || undefined,
            popped.rest || undefined,
        );
    }
    if (page.cursor) {
        const newPrev = pushCursor(prev, cursor ?? '');
        nextHref = listUrl(prefix, page.cursor, newPrev);
    }

    return {
        prefix,
        entries: page.entries,
        folderCount: page.folderCount,
        fileCount: page.fileCount,
        pageBytes: page.pageBytes,
        truncated: page.truncated,
        prevHref,
        nextHref,
    };
}

admin.get('/_admin/files', async c => {
    const { prefix, cursor, prev } = readFilesQuery(c);
    const props = await buildFileListProps(c.env.BUCKET, prefix, cursor, prev);
    return c.html(<FilesPage {...props} />);
});

admin.get('/_admin/files/list', async c => {
    const { prefix, cursor, prev } = readFilesQuery(c);
    const props = await buildFileListProps(c.env.BUCKET, prefix, cursor, prev);
    return c.html(<FileList {...props} />);
});

admin.post('/_admin/files/folder', async c => {
    const form = await c.req.formData();
    const parentRaw = String(form.get('parent') ?? '');
    const nameRaw = String(form.get('name') ?? '');
    let parent: string;
    let name: string;
    try {
        parent = parsePrefix(parentRaw);
        name = validateName(nameRaw);
    } catch (err) {
        return toastError(
            c,
            err instanceof Error ? err.message : 'Invalid folder',
            400,
        );
    }
    await createFolder(c.env.BUCKET, parent, name);
    log({ event: 'admin.files.folder.create', prefix: `${parent}${name}/` });
    const props = await buildFileListProps(c.env.BUCKET, parent, undefined, '');
    return c.html(
        withToast(
            <FileList {...props} />,
            'success',
            `Folder ${name}/ created.`,
        ),
    );
});

// ---------- multipart upload ----------

admin.post('/_admin/files/multipart/init', async c => {
    const form = await c.req.formData();
    const prefix = String(form.get('prefix') ?? '');
    const name = String(form.get('name') ?? '');
    const sizeRaw = Number(form.get('size'));
    const contentType = String(form.get('contentType') ?? '');
    if (!Number.isFinite(sizeRaw) || sizeRaw < 0) {
        return c.json({ error: 'invalid size' }, 400);
    }
    try {
        const result = await initMultipart(
            c.env.BUCKET,
            prefix,
            name,
            sizeRaw,
            contentType,
        );
        log({
            event: 'admin.files.multipart.init',
            key: result.key,
            size: sizeRaw,
            overwriting: result.overwriting,
            zero: result.uploadId === null,
        });
        return c.json(result);
    } catch (err) {
        return c.json(
            { error: err instanceof Error ? err.message : 'init failed' },
            400,
        );
    }
});

admin.put('/_admin/files/multipart/part', async c => {
    const uploadId = c.req.query('uploadId') ?? '';
    const key = c.req.query('key') ?? '';
    const partRaw = Number(c.req.query('part'));
    if (!uploadId || !key || !Number.isFinite(partRaw) || partRaw < 1) {
        return c.json({ error: 'missing uploadId/key/part' }, 400);
    }
    if (!c.req.raw.body) return c.json({ error: 'no body' }, 400);
    try {
        const part = await uploadPart(
            c.env.BUCKET,
            key,
            uploadId,
            partRaw,
            c.req.raw.body,
        );
        return c.json(part);
    } catch (err) {
        log({
            event: 'admin.files.multipart.part_fail',
            key,
            part: partRaw,
            error: err instanceof Error ? err.message : String(err),
        });
        return c.json(
            { error: err instanceof Error ? err.message : 'part failed' },
            400,
        );
    }
});

admin.post('/_admin/files/multipart/complete', async c => {
    let body: { uploadId?: unknown; key?: unknown; parts?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return toastError(c, 'Invalid request body.', 400);
    }
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    const key = typeof body.key === 'string' ? body.key : '';
    const parts = sanitizeParts(body.parts);
    if (!uploadId || !key || parts.length === 0) {
        return toastError(c, 'Invalid complete request.', 400);
    }
    try {
        await completeMultipart(c.env.BUCKET, key, uploadId, parts);
    } catch (err) {
        log({
            event: 'admin.files.multipart.complete_fail',
            key,
            error: err instanceof Error ? err.message : String(err),
        });
        return toastError(
            c,
            err instanceof Error ? err.message : 'Upload failed.',
            400,
        );
    }
    log({ event: 'admin.files.multipart.complete', key, parts: parts.length });
    const prefix = parentOf(key);
    const props = await buildFileListProps(c.env.BUCKET, prefix, undefined, '');
    return c.html(
        withToast(<FileList {...props} />, 'success', `Uploaded ${key}.`),
    );
});

admin.post('/_admin/files/multipart/abort', async c => {
    let body: { uploadId?: unknown; key?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'invalid body' }, 400);
    }
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    const key = typeof body.key === 'string' ? body.key : '';
    if (!uploadId || !key) return c.json({ error: 'missing fields' }, 400);
    try {
        await abortMultipart(c.env.BUCKET, key, uploadId);
        log({ event: 'admin.files.multipart.abort', key });
    } catch (err) {
        log({
            event: 'admin.files.multipart.abort_fail',
            key,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return c.body(null, 204);
});

function sanitizeParts(input: unknown): UploadedPart[] {
    if (!Array.isArray(input)) return [];
    const out: UploadedPart[] = [];
    for (const p of input) {
        if (
            p &&
            typeof p === 'object' &&
            typeof (p as { partNumber?: unknown }).partNumber === 'number' &&
            typeof (p as { etag?: unknown }).etag === 'string'
        ) {
            out.push({
                partNumber: (p as { partNumber: number }).partNumber,
                etag: (p as { etag: string }).etag,
            });
        }
    }
    return out;
}

// ---------- rename ----------

admin.get('/_admin/files/object/row', async c => {
    const key = c.req.query('key') ?? '';
    if (!key || key.includes('..')) return toastError(c, 'Invalid key.', 400);
    const head = await c.env.BUCKET.head(key);
    if (!head) return toastError(c, 'File not found.', 404);
    const prefix = parentOf(key);
    const name = key.slice(prefix.length);
    return c.html(
        <FileRowStatic
            entry={{ kind: 'file', name, key, size: head.size }}
            prefix={prefix}
        />,
    );
});

admin.get('/_admin/files/object/edit', async c => {
    const key = c.req.query('key') ?? '';
    if (!key || key.includes('..')) return toastError(c, 'Invalid key.', 400);
    const head = await c.env.BUCKET.head(key);
    if (!head) return toastError(c, 'File not found.', 404);
    const prefix = parentOf(key);
    const name = key.slice(prefix.length);
    return c.html(
        <FileRowEdit
            name={name}
            objectKey={key}
            prefix={prefix}
        />,
    );
});

admin.get('/_admin/files/folder/row', async c => {
    const raw = c.req.query('prefix') ?? '';
    let prefix: string;
    try {
        prefix = parsePrefix(raw);
    } catch {
        return toastError(c, 'Invalid folder.', 400);
    }
    if (!prefix) return toastError(c, 'Invalid folder.', 400);
    const parent = parentOf(prefix.replace(/\/+$/, ''));
    const name = prefix.slice(parent.length).replace(/\/+$/, '');
    return c.html(
        <FolderRowStatic
            entry={{ kind: 'folder', name, key: prefix }}
            prefix={parent}
        />,
    );
});

admin.get('/_admin/files/folder/edit', async c => {
    const raw = c.req.query('prefix') ?? '';
    let prefix: string;
    try {
        prefix = parsePrefix(raw);
    } catch {
        return toastError(c, 'Invalid folder.', 400);
    }
    if (!prefix) return toastError(c, 'Invalid folder.', 400);
    const parent = parentOf(prefix.replace(/\/+$/, ''));
    const name = prefix.slice(parent.length).replace(/\/+$/, '');
    return c.html(
        <FolderRowEdit
            name={name}
            prefix={prefix}
            parent={parent}
        />,
    );
});

admin.patch('/_admin/files/object', async c => {
    const form = await c.req.formData();
    const key = String(form.get('key') ?? '');
    const newName = String(form.get('newName') ?? '');
    if (!key || key.includes('..')) return toastError(c, 'Invalid key.', 400);
    let result: { newKey: string };
    try {
        result = await renameFile(c.env.BUCKET, key, newName);
    } catch (err) {
        return toastError(
            c,
            err instanceof Error ? err.message : 'Rename failed.',
            400,
        );
    }
    log({ event: 'admin.files.object.rename', from: key, to: result.newKey });
    const prefix = parentOf(key);
    const props = await buildFileListProps(c.env.BUCKET, prefix, undefined, '');
    return c.html(
        withToast(<FileList {...props} />, 'success', `Renamed to ${newName}.`),
    );
});

admin.patch('/_admin/files/folder', async c => {
    const form = await c.req.formData();
    const raw = String(form.get('prefix') ?? '');
    const newName = String(form.get('newName') ?? '');
    let prefix: string;
    try {
        prefix = parsePrefix(raw);
    } catch {
        return toastError(c, 'Invalid folder.', 400);
    }
    if (!prefix) return toastError(c, 'Invalid folder.', 400);
    let result: { renamed: number; newPrefix: string };
    try {
        result = await renameFolder(c.env.BUCKET, prefix, newName);
    } catch (err) {
        return toastError(
            c,
            err instanceof Error ? err.message : 'Rename failed.',
            400,
        );
    }
    log({
        event: 'admin.files.folder.rename',
        from: prefix,
        to: result.newPrefix,
        renamed: result.renamed,
    });
    const parent = parentOf(prefix.replace(/\/+$/, ''));
    const props = await buildFileListProps(c.env.BUCKET, parent, undefined, '');
    return c.html(
        withToast(
            <FileList {...props} />,
            'success',
            `Renamed ${result.renamed} item${result.renamed === 1 ? '' : 's'} to ${newName}/.`,
        ),
    );
});

admin.delete('/_admin/files/object', async c => {
    const key = c.req.query('key') ?? '';
    if (!key || key.includes('..')) return toastError(c, 'Invalid key.', 400);
    await c.env.BUCKET.delete(key);
    log({ event: 'admin.files.object.delete', key });
    const props = await buildFileListProps(
        c.env.BUCKET,
        parentOf(key),
        undefined,
        '',
    );
    return c.html(
        withToast(<FileList {...props} />, 'success', 'File deleted.'),
    );
});

admin.delete('/_admin/files/folder', async c => {
    const raw = c.req.query('prefix') ?? '';
    let prefix: string;
    try {
        prefix = parsePrefix(raw);
    } catch {
        return toastError(c, 'Invalid folder.', 400);
    }
    if (!prefix) return toastError(c, 'Refusing to delete root.', 400);
    const result = await deletePrefix(c.env.BUCKET, prefix);
    log({
        event: 'admin.files.folder.delete',
        prefix,
        deleted: result.deleted,
        truncated: result.truncated,
    });
    const props = await buildFileListProps(
        c.env.BUCKET,
        parentOf(prefix),
        undefined,
        '',
    );
    const msg = result.truncated
        ? `Deleted ${result.deleted}, more remain — run again.`
        : `Deleted ${result.deleted} item${result.deleted === 1 ? '' : 's'}.`;
    const level = result.truncated ? 'error' : 'success';
    return c.html(withToast(<FileList {...props} />, level, msg));
});

admin.all('*', c => c.text('not found', 404));

// ---------- helpers ----------

function normalizePrefix(input: string): string {
    return input.trim().replace(/^\/+/, '');
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++)
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}

export default admin;
