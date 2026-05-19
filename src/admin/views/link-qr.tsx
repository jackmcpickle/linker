import type { FC } from 'hono/jsx';
import type { ShareLink } from '../../types';
import { Layout } from './layout';
import { isoAt, relative } from '../../lib/time';
import { isNeverExpires } from '../../lib/expiry';

type Props = {
    link: ShareLink;
    shareDomain: string;
    shareUrl: string;
    svgUrl: string;
    downloadName: string;
};

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

export const LinkQrPage: FC<Props> = ({
    link,
    shareUrl,
    svgUrl,
    downloadName,
}) => {
    const s = status(link);
    const linkType = link.linkType ?? 'browse';
    return (
        <Layout title={`QR — ${link.name || link.token}`}>
            <main class="mx-auto max-w-2xl px-4 py-8">
                <div class="mb-4 text-sm">
                    <a
                        href="/_admin"
                        class="text-zinc-500 hover:text-zinc-900"
                    >
                        ← Back to links
                    </a>
                </div>
                <header class="mb-6">
                    <h1 class="text-xl font-semibold tracking-tight">
                        {link.name || link.token}
                    </h1>
                    <div class="mt-1 flex items-center gap-2 text-xs">
                        <span
                            class={`inline-block rounded-full px-2 py-0.5 ${statusBadge[s]}`}
                        >
                            {s}
                        </span>
                        <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">
                            {linkType}
                        </span>
                        {s === 'active' ? (
                            isNeverExpires(link.expiresAt) ? (
                                <span class="text-zinc-500">never expires</span>
                            ) : (
                                <span class="text-zinc-500">
                                    expires{' '}
                                    <time
                                        datetime={isoAt(link.expiresAt)}
                                        data-time-rel
                                    >
                                        {relative(link.expiresAt)}
                                    </time>
                                </span>
                            )
                        ) : null}
                    </div>
                </header>

                <div class="rounded-xl border border-zinc-200 bg-white p-6">
                    <div class="flex justify-center">
                        <img
                            src={svgUrl}
                            width="320"
                            height="320"
                            alt={`QR code for ${shareUrl}`}
                            class="h-80 w-80"
                        />
                    </div>
                    <div class="mt-6 text-center">
                        <a
                            href={shareUrl}
                            target="_blank"
                            rel="noopener"
                            class="font-mono text-xs break-all text-blue-700 hover:underline"
                        >
                            {shareUrl}
                        </a>
                    </div>
                    <div class="mt-6 flex justify-center gap-2">
                        <a
                            href={svgUrl}
                            download={downloadName}
                            class="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
                        >
                            Download SVG
                        </a>
                        <button
                            type="button"
                            class="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
                            data-copy={shareUrl}
                        >
                            Copy URL
                        </button>
                    </div>
                </div>

                <script
                    src="/admin.js"
                    defer
                ></script>
            </main>
        </Layout>
    );
};
