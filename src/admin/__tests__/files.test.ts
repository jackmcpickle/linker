import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CHUNK_SIZE,
    abortMultipart,
    collectFolderEntries,
    completeMultipart,
    contentDisposition,
    initMultipart,
    listAt,
    parsePrefix,
    parentOf,
    renameFile,
    renameFolder,
    uploadPart,
    validateName,
} from '../files';

const bucket = env.BUCKET;

async function emptyBucket() {
    let cursor: string | undefined;
    do {
        const res: R2Objects = await bucket.list({ limit: 1000, cursor });
        if (res.objects.length > 0) {
            await bucket.delete(res.objects.map(o => o.key));
        }
        cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
}

afterEach(emptyBucket);

describe('validateName', () => {
    it('accepts ordinary names', () => {
        expect(validateName('hello.txt')).toBe('hello.txt');
        expect(validateName('  spaced.pdf  ')).toBe('spaced.pdf');
    });
    it('rejects empty / . / ..', () => {
        expect(() => validateName('')).toThrow();
        expect(() => validateName('.')).toThrow();
        expect(() => validateName('..')).toThrow();
    });
    it('rejects path separators and control chars', () => {
        expect(() => validateName('a/b')).toThrow();
        expect(() => validateName('a\\b')).toThrow();
        expect(() => validateName('a\nb')).toThrow();
    });
});

describe('parsePrefix', () => {
    it('returns empty for root', () => {
        expect(parsePrefix('')).toBe('');
        expect(parsePrefix('/')).toBe('');
    });
    it('strips leading / and ensures trailing /', () => {
        expect(parsePrefix('foo')).toBe('foo/');
        expect(parsePrefix('/foo/bar')).toBe('foo/bar/');
    });
    it('rejects traversal', () => {
        expect(() => parsePrefix('foo/../bar')).toThrow();
    });
});

describe('parentOf', () => {
    it('returns empty for root keys', () => {
        expect(parentOf('top.txt')).toBe('');
    });
    it('returns the parent prefix', () => {
        expect(parentOf('a/b/c.txt')).toBe('a/b/');
        expect(parentOf('a/b/')).toBe('a/');
    });
});

describe('initMultipart', () => {
    it('creates a fresh multipart for non-empty files', async () => {
        const res = await initMultipart(
            bucket,
            'docs',
            'big.bin',
            10_000_000,
            'application/octet-stream',
        );
        expect(res.key).toBe('docs/big.bin');
        expect(res.uploadId).toBeTruthy();
        expect(res.partSize).toBe(CHUNK_SIZE);
        expect(res.overwriting).toBe(false);
        // cleanup
        if (res.uploadId) await abortMultipart(bucket, res.key, res.uploadId);
    });

    it('flags overwriting when target exists', async () => {
        await bucket.put('docs/a.txt', 'old');
        const res = await initMultipart(
            bucket,
            'docs',
            'a.txt',
            10,
            'text/plain',
        );
        expect(res.overwriting).toBe(true);
        if (res.uploadId) await abortMultipart(bucket, res.key, res.uploadId);
    });

    it('handles zero-byte files inline (no multipart)', async () => {
        const res = await initMultipart(
            bucket,
            'docs',
            'empty.txt',
            0,
            'text/plain',
        );
        expect(res.uploadId).toBeNull();
        const got = await bucket.get('docs/empty.txt');
        expect(got).not.toBeNull();
        expect(got!.size).toBe(0);
    });
});

describe('uploadPart + completeMultipart', () => {
    it('round-trips bytes via 2 parts', async () => {
        const init = await initMultipart(
            bucket,
            'docs',
            'parts.bin',
            6_000_000,
            'application/octet-stream',
        );
        expect(init.uploadId).toBeTruthy();
        const partA = new Uint8Array(5_242_880).fill(0xaa); // 5MB (min)
        const partB = new Uint8Array(524_288).fill(0xbb); // 0.5MB
        const p1 = await uploadPart(bucket, init.key, init.uploadId!, 1, partA);
        const p2 = await uploadPart(bucket, init.key, init.uploadId!, 2, partB);
        await completeMultipart(bucket, init.key, init.uploadId!, [p2, p1]);
        const got = await bucket.get(init.key);
        expect(got).not.toBeNull();
        expect(got!.size).toBe(partA.byteLength + partB.byteLength);
        const buf = new Uint8Array(await got!.arrayBuffer());
        expect(buf[0]).toBe(0xaa);
        expect(buf[partA.byteLength]).toBe(0xbb);
    });
});

describe('abortMultipart', () => {
    it('makes complete fail afterwards', async () => {
        const init = await initMultipart(
            bucket,
            'docs',
            'abort.bin',
            5_242_880,
            'application/octet-stream',
        );
        const part = await uploadPart(
            bucket,
            init.key,
            init.uploadId!,
            1,
            new Uint8Array(5_242_880),
        );
        await abortMultipart(bucket, init.key, init.uploadId!);
        await expect(
            completeMultipart(bucket, init.key, init.uploadId!, [part]),
        ).rejects.toBeDefined();
    });
});

describe('renameFile', () => {
    it('renames a small object and preserves contentType', async () => {
        await bucket.put('docs/old.txt', 'hello', {
            httpMetadata: { contentType: 'text/plain' },
        });
        const res = await renameFile(bucket, 'docs/old.txt', 'new.txt');
        expect(res.newKey).toBe('docs/new.txt');
        expect(await bucket.head('docs/old.txt')).toBeNull();
        const moved = await bucket.get('docs/new.txt');
        expect(moved).not.toBeNull();
        expect(moved!.httpMetadata?.contentType).toBe('text/plain');
        expect(await moved!.text()).toBe('hello');
    });

    it('rejects when target exists', async () => {
        await bucket.put('docs/a.txt', 'a');
        await bucket.put('docs/b.txt', 'b');
        await expect(
            renameFile(bucket, 'docs/a.txt', 'b.txt'),
        ).rejects.toThrow();
        // original still there
        const a = await bucket.get('docs/a.txt');
        expect(await a!.text()).toBe('a');
    });

    it('rejects invalid newName', async () => {
        await bucket.put('docs/a.txt', 'a');
        await expect(
            renameFile(bucket, 'docs/a.txt', 'b/c.txt'),
        ).rejects.toThrow();
    });

    it('rejects unchanged name', async () => {
        await bucket.put('docs/a.txt', 'a');
        await expect(
            renameFile(bucket, 'docs/a.txt', 'a.txt'),
        ).rejects.toThrow();
    });

    it('renames a large object via multipart-copy', async () => {
        // 30MB > CHUNK_SIZE (25MB): exercises multipartCopy
        const size = CHUNK_SIZE + 5 * 1024 * 1024;
        const src = new Uint8Array(size);
        for (let i = 0; i < size; i += 4096) src[i] = i & 0xff;
        await bucket.put('big/src.bin', src, {
            httpMetadata: { contentType: 'application/octet-stream' },
        });
        const res = await renameFile(bucket, 'big/src.bin', 'dst.bin');
        expect(res.newKey).toBe('big/dst.bin');
        expect(await bucket.head('big/src.bin')).toBeNull();
        const moved = await bucket.get('big/dst.bin');
        expect(moved!.size).toBe(size);
        const got = new Uint8Array(await moved!.arrayBuffer());
        for (let i = 0; i < size; i += 4096) {
            expect(got[i]).toBe(i & 0xff);
        }
    }, 30_000);
});

describe('renameFolder', () => {
    it('moves all keys under a prefix', async () => {
        await bucket.put('a/x.txt', 'x');
        await bucket.put('a/y.txt', 'y');
        await bucket.put('a/sub/z.txt', 'z');
        const res = await renameFolder(bucket, 'a/', 'b');
        expect(res.renamed).toBe(3);
        expect(res.newPrefix).toBe('b/');

        const page = await listAt(bucket, 'a/', undefined);
        expect(page.entries).toHaveLength(0);
        expect(await bucket.head('b/x.txt')).not.toBeNull();
        expect(await bucket.head('b/y.txt')).not.toBeNull();
        expect(await bucket.head('b/sub/z.txt')).not.toBeNull();
    });

    it('refuses to rename when destination prefix already has content', async () => {
        await bucket.put('a/x.txt', 'x');
        await bucket.put('b/existing.txt', 'e');
        await expect(renameFolder(bucket, 'a/', 'b')).rejects.toThrow(
            /already exists/,
        );
        expect(await bucket.head('a/x.txt')).not.toBeNull();
    });

    it('refuses to rename root', async () => {
        await expect(renameFolder(bucket, '', 'b')).rejects.toThrow();
    });

    it('refuses unchanged name', async () => {
        await bucket.put('a/x.txt', 'x');
        await expect(renameFolder(bucket, 'a/', 'a')).rejects.toThrow();
    });

    // Cap test: skipped by default because seeding 1001 objects against the
    // real R2 simulator is slow. Flip to `it(` locally to run.
    it.skip('refuses folders above RENAME_FOLDER_CAP', async () => {
        for (let i = 0; i < 1001; i++) {
            await bucket.put(`big/${i}.txt`, `${i}`);
        }
        await expect(renameFolder(bucket, 'big/', 'huge')).rejects.toThrow(
            /too large/,
        );
        // source untouched
        const head = await bucket.head('big/0.txt');
        expect(head).not.toBeNull();
    }, 120_000);
});

describe('contentDisposition', () => {
    it('returns plain attachment for ascii filenames', () => {
        const h = contentDisposition('hello.txt');
        expect(h).toBe('attachment; filename="hello.txt"');
    });
    it('adds RFC 5987 extended form for unicode', () => {
        const h = contentDisposition('café — résumé.pdf');
        expect(h).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
        expect(h).toContain(encodeURIComponent('café — résumé.pdf'));
    });
    it('strips quotes and backslashes from the ascii fallback', () => {
        const h = contentDisposition('quote".txt');
        expect(h).toContain('filename="quote_.txt"');
    });
});

describe('collectFolderEntries', () => {
    it('yields recursive entries with relative names and skips .keep', async () => {
        await bucket.put('a/.keep', new Uint8Array(0));
        await bucket.put('a/x.txt', 'x');
        await bucket.put('a/sub/y.txt', 'yy');
        await bucket.put('a/sub/.keep', new Uint8Array(0));

        const out: { name: string; size: number }[] = [];
        for await (const e of collectFolderEntries(bucket, 'a/')) {
            out.push({ name: e.name, size: e.size });
            // drain stream so R2 releases the body
            await e.input.cancel();
        }
        const names = out.map(o => o.name).sort();
        expect(names).toEqual(['sub/y.txt', 'x.txt']);
    });

    it('refuses root', async () => {
        await expect(async () => {
            for await (const _e of collectFolderEntries(bucket, '')) {
                /* nothing */
            }
        }).rejects.toThrow(/root/);
    });
});
