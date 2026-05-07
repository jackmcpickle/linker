import type { FC } from 'hono/jsx';
import type { ShareLink } from '../../types';
import { EXPIRY_PRESETS } from '../../lib/expiry';
import { isoAt, relative } from '../../lib/time';

type Props = {
    link: ShareLink;
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

export const LinkRow: FC<Props> = ({ link, shareDomain, mode = 'view' }) => {
    if (mode === 'edit') return <LinkRowEdit link={link} />;

    const s = status(link);
    const url = shareUrl(link.token, shareDomain);

    return (
        <tr id={`link-${link.token}`} class="border-b border-zinc-100 align-top">
            <td class="px-4 py-3">
                <div class="font-medium">{link.name || link.token}</div>
                {link.notes ? <div class="text-xs text-zinc-500 mt-0.5">{link.notes}</div> : null}
                <div class="text-xs text-zinc-400 mt-1 font-mono">{link.prefix}</div>
            </td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener"
                        class="text-xs font-mono text-blue-700 hover:underline truncate max-w-[18ch]"
                    >
                        {link.token}
                    </a>
                    <button
                        type="button"
                        class="text-xs text-zinc-500 hover:text-zinc-900"
                        data-copy={url}
                        title="Copy URL"
                    >
                        copy
                    </button>
                </div>
            </td>
            <td class="px-4 py-3">
                <span class={`inline-block rounded-full px-2 py-0.5 text-xs ${statusBadge[s]}`}>
                    {s}
                </span>
                {s === 'active' ? (
                    <div class="text-xs text-zinc-500 mt-1">
                        expires{' '}
                        <time datetime={isoAt(link.expiresAt)} data-time-rel>
                            {relative(link.expiresAt)}
                        </time>
                    </div>
                ) : null}
            </td>
            <td class="px-4 py-3 text-xs text-zinc-500">
                <div>{link.viewCount} views</div>
                {link.lastAccessedAt ? (
                    <div class="text-zinc-400">
                        <time datetime={isoAt(link.lastAccessedAt)} data-time-rel>
                            {relative(link.lastAccessedAt)}
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
                            <summary class="cursor-pointer text-xs rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50 list-none">
                                extend
                            </summary>
                            <div class="absolute right-0 mt-1 z-10 flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-white p-2 shadow-md">
                                {EXPIRY_PRESETS.map((p) => (
                                    <button
                                        type="button"
                                        class="text-xs rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-100"
                                        hx-post={`/_admin/links/${link.token}/extend`}
                                        hx-vals={JSON.stringify({ preset: p.id })}
                                        hx-target={`#link-${link.token}`}
                                        hx-swap="outerHTML"
                                    >
                                        {p.id}
                                    </button>
                                ))}
                            </div>
                        </details>
                    ) : null}
                    <button
                        type="button"
                        class="text-xs rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50"
                        hx-get={`/_admin/links/${link.token}/edit`}
                        hx-target={`#link-${link.token}`}
                        hx-swap="outerHTML"
                    >
                        edit
                    </button>
                    {s !== 'revoked' ? (
                        <button
                            type="button"
                            class="text-xs rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                            hx-post={`/_admin/links/${link.token}/revoke`}
                            hx-target={`#link-${link.token}`}
                            hx-swap="outerHTML"
                            hx-confirm="Revoke this link? Recipients will see the expired page immediately."
                        >
                            revoke
                        </button>
                    ) : null}
                    <button
                        type="button"
                        class="text-xs rounded border border-zinc-200 px-2 py-1 text-zinc-500 hover:text-red-700"
                        hx-delete={`/_admin/links/${link.token}`}
                        hx-target={`#link-${link.token}`}
                        hx-swap="outerHTML"
                        hx-confirm="Permanently delete this share record?"
                    >
                        delete
                    </button>
                </div>
            </td>
        </tr>
    );
};

const LinkRowEdit: FC<{ link: ShareLink }> = ({ link }) => (
    <tr id={`link-${link.token}`} class="border-b border-zinc-100 bg-zinc-50 align-top">
        <td colspan={5} class="px-4 py-4">
            <form
                hx-patch={`/_admin/links/${link.token}`}
                hx-target={`#link-${link.token}`}
                hx-swap="outerHTML"
                class="grid gap-3 md:grid-cols-2"
            >
                <label class="block">
                    <span class="block text-xs text-zinc-500 mb-1">Name</span>
                    <input
                        type="text"
                        name="name"
                        value={link.name}
                        required
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    />
                </label>
                <label class="block">
                    <span class="block text-xs text-zinc-500 mb-1">Prefix</span>
                    <input
                        type="text"
                        name="prefix"
                        value={link.prefix}
                        required
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
                    />
                </label>
                <label class="block md:col-span-2">
                    <span class="block text-xs text-zinc-500 mb-1">Notes</span>
                    <textarea
                        name="notes"
                        rows={2}
                        class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    >
                        {link.notes ?? ''}
                    </textarea>
                </label>
                <div class="md:col-span-2 flex gap-2">
                    <button
                        type="submit"
                        class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
                        hx-get={`/_admin/links/${link.token}`}
                        hx-target={`#link-${link.token}`}
                        hx-swap="outerHTML"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </td>
    </tr>
);
