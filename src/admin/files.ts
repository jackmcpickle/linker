/**
 * Admin file-browser server helpers. R2 has no folders — only key prefixes.
 * "Folders" are virtual: rendered from `delimitedPrefixes`, created by
 * uploading a zero-byte `.keep` marker.
 */

export const KEEP_FILE = '.keep';
export const PAGE_LIMIT = 50;
export const DELETE_CAP = 1000;
export const MAX_UPLOAD_BYTES = 95_000_000; // ~95MB; under Worker request cap
export const PREV_STACK_CAP = 50;

export type ListedEntry =
    | { kind: 'folder'; name: string; key: string }
    | {
          kind: 'file';
          name: string;
          key: string;
          size: number;
          uploaded?: Date;
      };

export type ListedPage = {
    entries: ListedEntry[];
    folderCount: number;
    fileCount: number;
    pageBytes: number;
    cursor?: string;
    truncated: boolean;
};

function hasControlOrBackslash(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 32 || c === 0x5c) return true;
    }
    return false;
}

function hasInvalidNameChar(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 32 || c === 0x2f || c === 0x5c) return true;
    }
    return false;
}

/** Normalize a folder prefix. Returns "" for root, otherwise ends with "/". */
export function parsePrefix(input: string): string {
    let p = input.trim();
    if (p === '' || p === '/') return '';
    p = p.replace(/^\/+/, '');
    if (p.includes('..') || hasControlOrBackslash(p)) {
        throw new Error('invalid prefix');
    }
    if (!p.endsWith('/')) p = p + '/';
    return p;
}

/** Validate a single path segment (folder or file name). */
export function validateName(name: string): string {
    const n = name.trim();
    if (!n) throw new Error('name required');
    if (n === '.' || n === '..') throw new Error('invalid name');
    if (hasInvalidNameChar(n)) throw new Error('invalid name');
    return n;
}

/** List one page at `prefix` with delimiter='/'. */
export async function listAt(
    bucket: R2Bucket,
    prefix: string,
    cursor: string | undefined,
): Promise<ListedPage> {
    const res = await bucket.list({
        prefix,
        delimiter: '/',
        limit: PAGE_LIMIT,
        cursor,
    });

    const folders: ListedEntry[] = (res.delimitedPrefixes ?? []).map(full => {
        const name = full.slice(prefix.length).replace(/\/+$/, '');
        return { kind: 'folder', name, key: full };
    });

    const files: ListedEntry[] = [];
    let pageBytes = 0;
    for (const o of res.objects) {
        const name = o.key.slice(prefix.length);
        if (name === KEEP_FILE) continue;
        files.push({
            kind: 'file',
            name,
            key: o.key,
            size: o.size,
            uploaded: o.uploaded,
        });
        pageBytes += o.size;
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return {
        entries: [...folders, ...files],
        folderCount: folders.length,
        fileCount: files.length,
        pageBytes,
        cursor: res.truncated ? res.cursor : undefined,
        truncated: res.truncated,
    };
}

/** Create a virtual folder by writing a zero-byte `.keep` marker. */
export async function createFolder(
    bucket: R2Bucket,
    parent: string,
    name: string,
): Promise<string> {
    const p = parsePrefix(parent);
    const n = validateName(name);
    const folderPrefix = `${p}${n}/`;
    await bucket.put(`${folderPrefix}${KEEP_FILE}`, new Uint8Array(0));
    return folderPrefix;
}

export type UploadOutcome = {
    name: string;
    status: 'ok' | 'overwritten' | 'too_large' | 'failed';
    bytes?: number;
    error?: string;
};

/** Upload a single file under `prefix`. Pre-checks for overwrite via head. */
export async function uploadFile(
    bucket: R2Bucket,
    prefix: string,
    file: File,
): Promise<UploadOutcome> {
    const name = validateName(file.name);
    if (file.size > MAX_UPLOAD_BYTES) {
        return { name, status: 'too_large', bytes: file.size };
    }
    const key = `${prefix}${name}`;
    const existing = await bucket.head(key);
    try {
        await bucket.put(key, file.stream(), {
            httpMetadata: {
                contentType: file.type || 'application/octet-stream',
            },
        });
    } catch (err) {
        return {
            name,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
        };
    }
    return {
        name,
        status: existing ? 'overwritten' : 'ok',
        bytes: file.size,
    };
}

export type DeleteResult = {
    deleted: number;
    truncated: boolean;
};

/** Recursively delete everything under `prefix`. Caps at DELETE_CAP keys. */
export async function deletePrefix(
    bucket: R2Bucket,
    prefix: string,
): Promise<DeleteResult> {
    if (!prefix) throw new Error('refusing to delete root');
    const collected: string[] = [];
    let cursor: string | undefined = undefined;
    let truncated = false;
    while (collected.length < DELETE_CAP) {
        const res: R2Objects = await bucket.list({
            prefix,
            limit: Math.min(1000, DELETE_CAP - collected.length),
            cursor,
        });
        for (const o of res.objects) collected.push(o.key);
        if (!res.truncated) {
            cursor = undefined;
            break;
        }
        cursor = res.cursor;
        if (collected.length >= DELETE_CAP) {
            truncated = true;
            break;
        }
    }
    if (collected.length === 0) return { deleted: 0, truncated };
    // R2 batch delete supports up to 1000 keys per call.
    for (let i = 0; i < collected.length; i += 1000) {
        await bucket.delete(collected.slice(i, i + 1000));
    }
    // Re-check whether anything remains beyond the cap.
    if (truncated) {
        const probe = await bucket.list({ prefix, limit: 1 });
        if (!probe.objects.length) truncated = false;
    }
    return { deleted: collected.length, truncated };
}

/** Cursor stack — encoded as base64url JSON array in URL `prev` param. */
export function pushCursor(prev: string, cursor: string): string {
    const stack = decodePrev(prev);
    stack.push(cursor);
    if (stack.length > PREV_STACK_CAP) stack.shift();
    return encodePrev(stack);
}

export function popCursor(prev: string): { cursor?: string; rest: string } {
    const stack = decodePrev(prev);
    const cursor = stack.pop();
    return { cursor, rest: encodePrev(stack) };
}

export function decodePrev(prev: string): string[] {
    if (!prev) return [];
    try {
        const json = atob(prev.replace(/-/g, '+').replace(/_/g, '/'));
        const arr = JSON.parse(json);
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

export function encodePrev(stack: string[]): string {
    if (stack.length === 0) return '';
    return btoa(JSON.stringify(stack)).replace(/\+/g, '-').replace(/\//g, '_');
}
