import type { FC } from 'hono/jsx';
import type { ShareLink } from '../../types';
import type { LinkPair } from '../../kv/links';
import { EXPIRY_PRESETS, isNeverExpires } from '../../lib/expiry';
import { isoAt, relative } from '../../lib/time';
import { Spinner } from './components/spinner';

type Props = {
    pair: LinkPair;
    shareDomain: string;
    mode?: 'view' | 'edit';
};

function shareUrl(token: string, shareDomain: string): string {
    return `https://${token}.${shareDomain}/`;
}

function status(link: ShareLink): 'active' | 'revoked' | 'expired' {
    if (link.revokedAt) return 'revoked';
    if (link.expiresAt <= Date.now()) return 'expired';
    return 'active';
}

const statusBadge = {
    active: 'bg-emerald-100 text-emerald-700',
    revoked: 'bg-red-100 text-red-700',
    expired: 'bg-zinc-200 text-zinc-600',
} as const;

export const LinkRow: FC<Props> = ({ pair, shareDomain, mode = 'view' }) => {
    const canonical = pair.browse;
    if (mode === 'edit') return <LinkRowEdit link={canonical} />;

    const s = status(canonical);
    const viewUrl = shareUrl(canonical.token, shareDomain);
    const downloadUrl = pair.download
        ? shareUrl(pair.download.token, shareDomain)
        : null;
    const totalViews = canonical.viewCount + (pair.download?.viewCount ?? 0);
    const totalDownloads = pair.download?.downloadCount ?? 0;
    const lastAccessed = Math.max(
        canonical.lastAccessedAt ?? 0,
        pair.download?.lastAccessedAt ?? 0,
    );

    return (
        <tr
            id={`link-${canonical.token}`}
            class="border-b border-zinc-100 align-top"
        >
            <td class="px-4 py-3">
                <div class="font-medium">
                    {canonical.name || canonical.token}
                </div>
                {canonical.notes ? (
                    <div class="mt-0.5 text-xs text-zinc-500">
                        {canonical.notes}
                    </div>
                ) : null}
                <div class="mt-1 font-mono text-xs text-zinc-400">
                    {canonical.prefix}
                </div>
            </td>
            <td class="px-4 py-3">
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center gap-2">
                        <span class="w-20 text-xs text-zinc-500">
                            View link
                        </span>
                        <a
                            href={viewUrl}
                            target="_blank"
                            rel="noopener"
                            class="max-w-[18ch] truncate font-mono text-xs text-blue-700 hover:underline"
                        >
                            {canonical.token}
                        </a>
                        <button
                            type="button"
                            class="text-xs text-zinc-500 hover:text-zinc-900"
                            data-copy={viewUrl}
                            title="Copy view URL"
                        >
                            copy
                        </button>
                    </div>
                    {downloadUrl && pair.download ? (
                        <div class="flex items-center gap-2">
                            <span class="w-20 text-xs text-zinc-500">
                                Download link
                            </span>
                            <a
                                href={downloadUrl}
                                target="_blank"
                                rel="noopener"
                                class="max-w-[18ch] truncate font-mono text-xs text-blue-700 hover:underline"
                            >
                                {pair.download.token}
                            </a>
                            <button
                                type="button"
                                class="text-xs text-zinc-500 hover:text-zinc-900"
                                data-copy={downloadUrl}
                                title="Copy download URL"
                            >
                                copy
                            </button>
                        </div>
                    ) : (
                        <div class="flex items-center gap-2">
                            <span class="w-20 text-xs text-zinc-500">
                                Download link
                            </span>
                            <button
                                type="button"
                                class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                                hx-post={`/_admin/links/${canonical.token}/pair`}
                                hx-target={`#link-${canonical.token}`}
                                hx-swap="outerHTML"
                                title="Create a paired download link for this share"
                            >
                                <Spinner class="h-3 w-3" />
                                Create download link
                            </button>
                        </div>
                    )}
                </div>
            </td>
            <td class="px-4 py-3">
                <span
                    class={`inline-block rounded-full px-2 py-0.5 text-xs ${statusBadge[s]}`}
                >
                    {s}
                </span>
                {s === 'active' ? (
                    isNeverExpires(canonical.expiresAt) ? (
                        <div class="mt-1 text-xs text-zinc-500">
                            never expires
                        </div>
                    ) : (
                        <div class="mt-1 text-xs text-zinc-500">
                            expires{' '}
                            <time
                                datetime={isoAt(canonical.expiresAt)}
                                data-time-rel
                            >
                                {relative(canonical.expiresAt)}
                            </time>
                        </div>
                    )
                ) : null}
            </td>
            <td class="px-4 py-3 text-xs text-zinc-500">
                <div>{totalViews} views</div>
                {pair.download ? <div>{totalDownloads} downloads</div> : null}
                {lastAccessed > 0 ? (
                    <div class="text-zinc-400">
                        <time
                            datetime={isoAt(lastAccessed)}
                            data-time-rel
                        >
                            {relative(lastAccessed)}
                        </time>
                    </div>
                ) : (
                    <div class="text-zinc-400">never</div>
                )}
            </td>
            <td class="px-4 py-3">
                <div class="flex flex-wrap items-center gap-1.5">
                    {s !== 'revoked' ? (
                        <details class="group relative">
                            <summary class="cursor-pointer list-none rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50">
                                extend
                            </summary>
                            <div class="absolute right-0 z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-white p-2 shadow-md">
                                {EXPIRY_PRESETS.map(p => (
                                    <button
                                        type="button"
                                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100"
                                        hx-post={`/_admin/links/${canonical.token}/extend`}
                                        hx-vals={JSON.stringify({
                                            preset: p.id,
                                        })}
                                        hx-target={`#link-${canonical.token}`}
                                        hx-swap="outerHTML"
                                    >
                                        <Spinner class="h-3 w-3" />
                                        {p.id}
                                    </button>
                                ))}
                            </div>
                        </details>
                    ) : null}
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
                        hx-get={`/_admin/links/${canonical.token}/edit`}
                        hx-target={`#link-${canonical.token}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner class="h-3 w-3" />
                        edit
                    </button>
                    {s !== 'revoked' ? (
                        <button
                            type="button"
                            class="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            hx-post={`/_admin/links/${canonical.token}/revoke`}
                            hx-target={`#link-${canonical.token}`}
                            hx-swap="outerHTML"
                            hx-confirm="Revoke this link? Recipients will see the expired page immediately."
                        >
                            <Spinner class="h-3 w-3" />
                            revoke
                        </button>
                    ) : null}
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:text-red-700"
                        hx-delete={`/_admin/links/${canonical.token}`}
                        hx-target={`#link-${canonical.token}`}
                        hx-swap="outerHTML"
                        hx-confirm="Permanently delete this share record?"
                    >
                        <Spinner class="h-3 w-3" />
                        delete
                    </button>
                </div>
            </td>
        </tr>
    );
};

const LinkRowEdit: FC<{ link: ShareLink }> = ({ link }) => (
    <tr
        id={`link-${link.token}`}
        class="border-b border-zinc-100 bg-zinc-50 align-top"
    >
        <td
            colspan={5}
            class="px-4 py-4"
        >
            <form
                hx-patch={`/_admin/links/${link.token}`}
                hx-target={`#link-${link.token}`}
                hx-swap="outerHTML"
                class="grid gap-3 md:grid-cols-2"
            >
                <label class="block">
                    <span class="mb-1 block text-xs text-zinc-500">Name</span>
                    <input
                        type="text"
                        name="name"
                        value={link.name}
                        required
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    />
                </label>
                <label class="block">
                    <span class="mb-1 block text-xs text-zinc-500">Folder</span>
                    <input
                        type="text"
                        name="prefix"
                        value={link.prefix}
                        required
                        autocomplete="off"
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
                        hx-get="/_admin/prefixes"
                        hx-trigger="input changed delay:200ms, focus"
                        hx-target="next .prefix-suggestions"
                        hx-swap="innerHTML"
                        hx-params="prefix"
                    />
                    <div class="prefix-suggestions mt-1 text-xs text-zinc-500"></div>
                </label>
                <label class="block md:col-span-2">
                    <span class="mb-1 block text-xs text-zinc-500">Notes</span>
                    <textarea
                        name="notes"
                        rows={2}
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    >
                        {link.notes ?? ''}
                    </textarea>
                </label>
                <div class="flex gap-2 md:col-span-2">
                    <button
                        type="submit"
                        class="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                        <Spinner />
                        Save
                    </button>
                    <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
                        hx-get={`/_admin/links/${link.token}`}
                        hx-target={`#link-${link.token}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner />
                        Cancel
                    </button>
                </div>
            </form>
        </td>
    </tr>
);
