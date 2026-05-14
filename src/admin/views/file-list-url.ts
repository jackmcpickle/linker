export function listUrl(
    prefix: string,
    cursor?: string,
    prev?: string,
): string {
    const qp = new URLSearchParams();
    if (prefix) qp.set('prefix', prefix);
    if (cursor) qp.set('cursor', cursor);
    if (prev) qp.set('prev', prev);
    const s = qp.toString();
    return s ? `/_admin/files?${s}` : '/_admin/files';
}
