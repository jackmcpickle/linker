/**
 * Admin file-browser server helpers. R2 has no folders — only key prefixes.
 * "Folders" are virtual: rendered from `delimitedPrefixes`, created by
 * uploading a zero-byte `.keep` marker.
 */

export const KEEP_FILE = '.keep';
export const PAGE_LIMIT = 50;
export const DELETE_CAP = 1000;
export const PREV_STACK_CAP = 50;

// Uploads are chunked via R2 multipart so single-request body limits don't
// gate file size. 25MB chunk: under the ~95MB Worker request cap, above the
// R2 5MB minimum part size.
export const CHUNK_SIZE = 25 * 1024 * 1024;

// Folder rename refuses if the folder contains more than this many keys —
// keeps a rename request bounded to a single Worker invocation.
export const RENAME_FOLDER_CAP = DELETE_CAP;

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

/** Parent prefix of a key or folder prefix. Returns "" for root. */
export function parentOf(keyOrPrefix: string): string {
    const trimmed = keyOrPrefix.replace(/\/+$/, '');
    const slash = trimmed.lastIndexOf('/');
    if (slash < 0) return '';
    return trimmed.slice(0, slash + 1);
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

// ---------- multipart upload ----------

export type InitMultipartResult = {
    /** null when the file was 0 bytes — already written, no parts to send. */
    uploadId: string | null;
    key: string;
    partSize: number;
    overwriting: boolean;
};

export type UploadedPart = { partNumber: number; etag: string };

/**
 * Begin (or short-circuit) a multipart upload.
 * Zero-byte files bypass multipart since R2 multipart needs ≥1 part.
 */
export async function initMultipart(
    bucket: R2Bucket,
    prefix: string,
    name: string,
    size: number,
    contentType: string,
): Promise<InitMultipartResult> {
    const p = parsePrefix(prefix);
    const n = validateName(name);
    const key = `${p}${n}`;
    const existing = await bucket.head(key);
    const overwriting = existing !== null;

    if (size === 0) {
        await bucket.put(key, new Uint8Array(0), {
            httpMetadata: {
                contentType: contentType || 'application/octet-stream',
            },
        });
        return { uploadId: null, key, partSize: CHUNK_SIZE, overwriting };
    }

    const mpu = await bucket.createMultipartUpload(key, {
        httpMetadata: {
            contentType: contentType || 'application/octet-stream',
        },
    });
    return {
        uploadId: mpu.uploadId,
        key,
        partSize: CHUNK_SIZE,
        overwriting,
    };
}

/** Upload one part. partNumber must be 1-based. */
export async function uploadPart(
    bucket: R2Bucket,
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string,
): Promise<UploadedPart> {
    const mpu = bucket.resumeMultipartUpload(key, uploadId);
    const part = await mpu.uploadPart(partNumber, body);
    return { partNumber: part.partNumber, etag: part.etag };
}

/** Finalize the upload. Sorts parts defensively. */
export async function completeMultipart(
    bucket: R2Bucket,
    key: string,
    uploadId: string,
    parts: UploadedPart[],
): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const mpu = bucket.resumeMultipartUpload(key, uploadId);
    await mpu.complete(sorted);
}

export async function abortMultipart(
    bucket: R2Bucket,
    key: string,
    uploadId: string,
): Promise<void> {
    const mpu = bucket.resumeMultipartUpload(key, uploadId);
    await mpu.abort();
}

// ---------- rename ----------

/**
 * Internal: copy `srcKey` to `dstKey` using R2 multipart, reading the source
 * in CHUNK_SIZE ranges. Used when the source is too large to stream-put in one
 * Worker invocation. Preserves httpMetadata only.
 */
async function multipartCopy(
    bucket: R2Bucket,
    srcKey: string,
    dstKey: string,
    size: number,
    httpMetadata: R2HTTPMetadata | undefined,
): Promise<void> {
    const mpu = await bucket.createMultipartUpload(dstKey, { httpMetadata });
    const parts: R2UploadedPart[] = [];
    try {
        let partNumber = 1;
        for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
            const length = Math.min(CHUNK_SIZE, size - offset);
            const chunk = await bucket.get(srcKey, {
                range: { offset, length },
            });
            if (!chunk) throw new Error('source disappeared mid-copy');
            const part = await mpu.uploadPart(partNumber, chunk.body);
            parts.push(part);
            partNumber += 1;
        }
        await mpu.complete(parts);
    } catch (err) {
        try {
            await mpu.abort();
        } catch {
            // swallow abort failures — the original error is what matters.
        }
        throw err;
    }
}

/** Copy `srcKey` to `dstKey`. Size-aware: stream-put if small, multipart-copy otherwise. */
async function copyObject(
    bucket: R2Bucket,
    srcKey: string,
    dstKey: string,
): Promise<void> {
    const src = await bucket.get(srcKey);
    if (!src) throw new Error('source not found');
    if (src.size <= CHUNK_SIZE) {
        await bucket.put(dstKey, src.body, {
            httpMetadata: src.httpMetadata,
        });
        return;
    }
    await multipartCopy(bucket, srcKey, dstKey, src.size, src.httpMetadata);
}

export type RenameFileResult = { newKey: string };

/** Rename a single object. Refuses if target exists. Preserves httpMetadata. */
export async function renameFile(
    bucket: R2Bucket,
    oldKey: string,
    newName: string,
): Promise<RenameFileResult> {
    const n = validateName(newName);
    const newKey = `${parentOf(oldKey)}${n}`;
    if (newKey === oldKey) throw new Error('name unchanged');
    const collision = await bucket.head(newKey);
    if (collision) throw new Error('a file with that name already exists');
    await copyObject(bucket, oldKey, newKey);
    await bucket.delete(oldKey);
    return { newKey };
}

export type RenameFolderResult = { renamed: number; newPrefix: string };

/**
 * Rename a folder by copying every key under `oldPrefix` to a new prefix
 * derived from `newName`, then deleting the source keys. Pre-counts keys and
 * refuses if > RENAME_FOLDER_CAP, so we never start a partial rename.
 *
 * On a per-copy failure we best-effort delete the destination keys we've
 * already written and rethrow. The source is left intact in that case.
 */
export async function renameFolder(
    bucket: R2Bucket,
    oldPrefix: string,
    newName: string,
): Promise<RenameFolderResult> {
    const src = parsePrefix(oldPrefix);
    if (!src) throw new Error('refusing to rename root');
    const n = validateName(newName);
    const parent = parentOf(src.replace(/\/+$/, ''));
    const newPrefix = `${parent}${n}/`;
    if (newPrefix === src) throw new Error('name unchanged');

    const collision = await bucket.list({ prefix: newPrefix, limit: 1 });
    if (collision.objects.length > 0) {
        throw new Error('a folder with that name already exists');
    }

    // Pre-flight: collect keys, bail if over the cap before any mutation.
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
        const page: R2Objects = await bucket.list({
            prefix: src,
            limit: 1000,
            cursor,
        });
        for (const o of page.objects) keys.push(o.key);
        if (keys.length > RENAME_FOLDER_CAP) {
            throw new Error(
                `folder too large to rename — limit ${RENAME_FOLDER_CAP} items`,
            );
        }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const written: string[] = [];
    try {
        for (const oldKey of keys) {
            const dstKey = `${newPrefix}${oldKey.slice(src.length)}`;
            await copyObject(bucket, oldKey, dstKey);
            written.push(dstKey);
        }
    } catch (err) {
        // Best-effort rollback. If this itself fails, the user is told about
        // possible duplicates via the toast — we don't retry.
        if (written.length > 0) {
            try {
                for (let i = 0; i < written.length; i += 1000) {
                    await bucket.delete(written.slice(i, i + 1000));
                }
            } catch {
                // intentionally swallowed; surfaced via caller's toast text
            }
        }
        throw err;
    }

    for (let i = 0; i < keys.length; i += 1000) {
        await bucket.delete(keys.slice(i, i + 1000));
    }
    return { renamed: keys.length, newPrefix };
}

// ---------- delete (existing) ----------

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
    for (let i = 0; i < collected.length; i += 1000) {
        await bucket.delete(collected.slice(i, i + 1000));
    }
    if (truncated) {
        const probe = await bucket.list({ prefix, limit: 1 });
        if (!probe.objects.length) truncated = false;
    }
    return { deleted: collected.length, truncated };
}

// ---------- cursor stack (existing) ----------

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
