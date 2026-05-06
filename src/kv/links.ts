import type { ShareLink } from "../types";

const KEY_PREFIX = "link:";
const k = (token: string) => `${KEY_PREFIX}${token}`;

/**
 * Storage strategy: full ShareLink in KV value (canonical) AND duplicated in
 * key metadata so `list` returns enough to render the dashboard without N reads.
 * Metadata limit is 1KB per key — our records are well under that.
 */

export async function getLink(kv: KVNamespace, token: string): Promise<ShareLink | null> {
  const res = await kv.getWithMetadata<ShareLink, ShareLink>(k(token), "json");
  if (res.value) return res.value;
  // fall back to metadata if value somehow missing
  return res.metadata ?? null;
}

export async function putLink(kv: KVNamespace, link: ShareLink): Promise<void> {
  await kv.put(k(link.token), JSON.stringify(link), { metadata: link });
}

export async function deleteLink(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(k(token));
}

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
  // newest first
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
