import type { ShareLink } from '../types';

const KEY_PREFIX = 'link:';
const k = (token: string) => `${KEY_PREFIX}${token}`;

/**
 * Storage strategy: full ShareLink in KV value (canonical) AND duplicated in
 * key metadata so `list` returns enough to render the dashboard without N reads.
 * Metadata limit is 1KB per key — our records are well under that.
 */

export async function getLink(
    kv: KVNamespace,
    token: string,
): Promise<ShareLink | null> {
    const res = await kv.getWithMetadata<ShareLink, ShareLink>(
        k(token),
        'json',
    );
    if (res.value) return res.value;
    return res.metadata ?? null;
}

export async function putLink(kv: KVNamespace, link: ShareLink): Promise<void> {
    await kv.put(k(link.token), JSON.stringify(link), { metadata: link });
}

export async function deleteLink(
    kv: KVNamespace,
    token: string,
): Promise<void> {
    await kv.delete(k(token));
}

/**
 * Return every record (no pair collapsing). Sorted newest first.
 * Use `listPairs` for dashboard rendering.
 */
export async function listLinks(kv: KVNamespace): Promise<ShareLink[]> {
    const out: ShareLink[] = [];
    let cursor: string | undefined;
    do {
        const res = await kv.list<ShareLink>({ prefix: KEY_PREFIX, cursor });
        for (const item of res.keys) {
            if (item.metadata) out.push(item.metadata);
        }
        cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
}

export type LinkPair = {
    /** Always present. Legacy unpaired links are browse-only. */
    browse: ShareLink;
    /** Present when a download partner exists. */
    download?: ShareLink;
};

/**
 * Collapse list view to one entry per pair, preferring the browse record as
 * canonical. Orphan download tokens (whose browse partner was hand-deleted)
 * surface as a synthetic pair with `browse` swapped — UI can still detect via
 * `link.linkType === 'download'` if needed, but in practice the surviving
 * record drives the row.
 */
export async function listPairs(kv: KVNamespace): Promise<LinkPair[]> {
    const all = await listLinks(kv);
    const byToken = new Map(all.map(l => [l.token, l] as const));
    const seen = new Set<string>();
    const pairs: LinkPair[] = [];

    for (const link of all) {
        if (seen.has(link.token)) continue;
        const type = link.linkType ?? 'browse';
        const partner = link.pairedToken
            ? byToken.get(link.pairedToken)
            : undefined;

        if (type === 'browse') {
            pairs.push({ browse: link, download: partner });
            seen.add(link.token);
            if (partner) seen.add(partner.token);
        } else {
            // Download record. If its browse partner exists we'll handle the
            // pair when we hit that record in the outer loop — skip here so
            // we don't add it twice.
            if (partner) {
                pairs.push({ browse: partner, download: link });
                seen.add(link.token);
                seen.add(partner.token);
            } else {
                // Orphan download — render as a single-URL row.
                pairs.push({ browse: link, download: undefined });
                seen.add(link.token);
            }
        }
    }

    pairs.sort((a, b) => b.browse.createdAt - a.browse.createdAt);
    return pairs;
}

/**
 * Write both halves of a pair. Browse first, then download. If the download
 * write throws, attempt to delete the browse half so a half-written pair
 * doesn't leak into the dashboard.
 */
export async function putPair(
    kv: KVNamespace,
    browse: ShareLink,
    download: ShareLink,
): Promise<void> {
    await putLink(kv, browse);
    try {
        await putLink(kv, download);
    } catch (err) {
        try {
            await deleteLink(kv, browse.token);
        } catch {
            // best-effort; the rethrown error is what the caller surfaces
        }
        throw err;
    }
}

/** Read a record's partner (or null if unpaired / partner missing). */
export async function getPartner(
    kv: KVNamespace,
    link: ShareLink,
): Promise<ShareLink | null> {
    if (!link.pairedToken) return null;
    return getLink(kv, link.pairedToken);
}

/**
 * Apply `patch` to both halves of a pair, preserving role-specific fields
 * (token, linkType, pairedToken, viewCount, downloadCount). Used by
 * extend/revoke/rename/notes updates that should affect both URLs.
 *
 * Returns the updated record matching `link.token` (caller's perspective).
 */
export async function mutatePair(
    kv: KVNamespace,
    link: ShareLink,
    patch: Partial<
        Pick<ShareLink, 'name' | 'notes' | 'prefix' | 'expiresAt' | 'revokedAt'>
    >,
): Promise<ShareLink> {
    const partner = await getPartner(kv, link);
    const updated: ShareLink = { ...link, ...patch };
    await putLink(kv, updated);
    if (partner) {
        const updatedPartner: ShareLink = { ...partner, ...patch };
        try {
            await putLink(kv, updatedPartner);
        } catch {
            // log + tolerate; next mutation re-converges
        }
    }
    return updated;
}

/** Delete both halves of a pair. */
export async function deletePair(
    kv: KVNamespace,
    link: ShareLink,
): Promise<void> {
    await deleteLink(kv, link.token);
    if (link.pairedToken) {
        try {
            await deleteLink(kv, link.pairedToken);
        } catch {
            // best-effort
        }
    }
}
