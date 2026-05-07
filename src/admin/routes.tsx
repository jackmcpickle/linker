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
    createFolder,
    deletePrefix,
    listAt,
    parsePrefix,
    popCursor,
    pushCursor,
    uploadFile,
    validateName,
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

    // limit guards against accidentally huge listings; UI can paginate later
    const res = await c.env.BUCKET.list({
        prefix: q,
        delimiter: '/',
        limit: 50,
    });

    const folders = (res.delimitedPrefixes ?? []).slice(0, 12);
    const files = res.objects
        .map(o => o.key)
        .filter(k => k !== q) // hide exact-match echo
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
        // current cursor (possibly empty) is pushed onto stack as we move forward.
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

admin.post('/_admin/files/upload', async c => {
    const form = await c.req.formData();
    let prefix: string;
    try {
        prefix = parsePrefix(String(form.get('prefix') ?? ''));
    } catch {
        return toastError(c, 'Invalid target folder.', 400);
    }
    const raw = form.getAll('files');
    const files: File[] = [];
    for (const v of raw) {
        if (typeof v !== 'string') files.push(v);
    }
    if (files.length === 0) return toastError(c, 'No files selected.', 400);

    let ok = 0;
    let overwritten = 0;
    const tooLarge: string[] = [];
    const failed: string[] = [];
    for (const f of files) {
        const r = await uploadFile(c.env.BUCKET, prefix, f);
        if (r.status === 'ok') ok += 1;
        else if (r.status === 'overwritten') {
            ok += 1;
            overwritten += 1;
        } else if (r.status === 'too_large') tooLarge.push(r.name);
        else failed.push(r.name);
    }
    log({
        event: 'admin.files.upload',
        prefix,
        ok,
        overwritten,
        tooLarge: tooLarge.length,
        failed: failed.length,
    });
    const props = await buildFileListProps(c.env.BUCKET, prefix, undefined, '');
    const parts: string[] = [];
    parts.push(`Uploaded ${ok}`);
    if (overwritten > 0) parts.push(`${overwritten} overwritten`);
    if (tooLarge.length > 0)
        parts.push(`${tooLarge.length} too large: ${tooLarge.join(', ')}`);
    if (failed.length > 0)
        parts.push(`${failed.length} failed: ${failed.join(', ')}`);
    const msg = parts.join(' · ');
    const level =
        failed.length > 0 || tooLarge.length > 0 ? 'error' : 'success';
    return c.html(withToast(<FileList {...props} />, level, msg));
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

function parentOf(keyOrPrefix: string): string {
    const trimmed = keyOrPrefix.replace(/\/+$/, '');
    const slash = trimmed.lastIndexOf('/');
    if (slash < 0) return '';
    return trimmed.slice(0, slash + 1);
}

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
