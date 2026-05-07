import type { FC } from 'hono/jsx';
import type { ListedEntry } from '../files';
import { Spinner } from './components/spinner';

type Crumb = { label: string; prefix: string };

type Props = {
    prefix: string;
    entries: ListedEntry[];
    folderCount: number;
    fileCount: number;
    pageBytes: number;
    truncated: boolean;
    prevHref?: string;
    nextHref?: string;
};

function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function buildCrumbs(prefix: string): Crumb[] {
    const out: Crumb[] = [{ label: 'root', prefix: '' }];
    if (!prefix) return out;
    const parts = prefix.replace(/\/+$/, '').split('/');
    let acc = '';
    for (const part of parts) {
        acc += `${part}/`;
        out.push({ label: part, prefix: acc });
    }
    return out;
}

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

export const FileList: FC<Props> = ({
    prefix,
    entries,
    folderCount,
    fileCount,
    pageBytes,
    truncated,
    prevHref,
    nextHref,
}) => {
    const crumbs = buildCrumbs(prefix);
    return (
        <div id="file-content">
            <CreateFolderForm parent={prefix} />
            <UploadDropzone prefix={prefix} />

            <div class="mb-3">
                <input
                    type="text"
                    data-filter
                    placeholder="Filter this page…"
                    class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 focus:outline-none"
                />
            </div>

            <nav class="mb-2 flex flex-wrap items-center gap-1 font-mono text-sm">
                {crumbs.map((c, i) => (
                    <>
                        {i > 0 ? <span class="text-zinc-400">/</span> : null}
                        <a
                            href={listUrl(c.prefix)}
                            class="rounded px-1.5 py-0.5 hover:bg-zinc-100"
                        >
                            {c.label}
                        </a>
                    </>
                ))}
            </nav>

            <div class="rounded-xl border border-zinc-200 bg-white">
                <header class="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                    {folderCount} folders · {fileCount} files ·{' '}
                    {fmtSize(pageBytes)}
                    {truncated ? ' (this page)' : ''}
                </header>

                {entries.length === 0 ? (
                    <div class="px-4 py-6 text-center text-sm text-zinc-500">
                        empty folder
                        {prefix ? (
                            <>
                                {' '}
                                ·{' '}
                                <button
                                    type="button"
                                    class="text-red-700 hover:underline"
                                    hx-delete={`/_admin/files/folder?prefix=${encodeURIComponent(
                                        prefix,
                                    )}`}
                                    hx-target="#file-content"
                                    hx-swap="outerHTML"
                                    hx-confirm={`Delete empty folder ${prefix}?`}
                                >
                                    delete folder
                                </button>
                            </>
                        ) : null}
                    </div>
                ) : (
                    <table class="w-full text-sm">
                        <tbody>
                            {entries.map(e => (
                                <Row
                                    entry={e}
                                    prefix={prefix}
                                />
                            ))}
                        </tbody>
                    </table>
                )}

                <footer class="flex items-center justify-between border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                    <span>{truncated ? 'paginated' : ''}</span>
                    <div class="flex gap-1">
                        <PageLink
                            href={prevHref}
                            label="← prev"
                        />
                        <PageLink
                            href={nextHref}
                            label="next →"
                        />
                    </div>
                </footer>
            </div>
        </div>
    );
};

const Row: FC<{ entry: ListedEntry; prefix: string }> = ({ entry, prefix }) => {
    if (entry.kind === 'folder') {
        const childPrefix = `${prefix}${entry.name}/`;
        return (
            <tr
                class="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50"
                data-name={entry.name.toLowerCase()}
            >
                <td class="w-6 px-4 py-2 text-zinc-400">▸</td>
                <td class="px-2 py-2 font-mono">
                    <a
                        href={listUrl(childPrefix)}
                        class="hover:underline"
                    >
                        {entry.name}/
                    </a>
                </td>
                <td class="px-2 py-2 text-right text-xs text-zinc-400">
                    folder
                </td>
                <td class="px-4 py-2 text-right">
                    <div class="inline-flex items-center gap-1.5">
                        <a
                            href={`/_admin?prefix=${encodeURIComponent(
                                childPrefix,
                            )}#create-form`}
                            class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                            title="Create share link for this folder"
                        >
                            + link
                        </a>
                        <button
                            type="button"
                            class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-red-200 hover:text-red-700"
                            hx-delete={`/_admin/files/folder?prefix=${encodeURIComponent(
                                childPrefix,
                            )}`}
                            hx-target="#file-content"
                            hx-swap="outerHTML"
                            hx-confirm={`Recursively delete ${childPrefix} and everything under it?`}
                        >
                            <Spinner class="h-3 w-3" />
                            delete
                        </button>
                    </div>
                </td>
            </tr>
        );
    }

    return (
        <tr
            class="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50"
            data-name={entry.name.toLowerCase()}
        >
            <td class="w-6 px-4 py-2 text-zinc-400">·</td>
            <td class="px-2 py-2 font-mono break-all">{entry.name}</td>
            <td class="px-2 py-2 text-right text-xs text-zinc-400">
                {fmtSize(entry.size)}
            </td>
            <td class="px-4 py-2 text-right">
                <div class="inline-flex items-center gap-1.5">
                    <a
                        href={`/_admin?prefix=${encodeURIComponent(
                            entry.key,
                        )}#create-form`}
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        title="Create share link for this file"
                    >
                        + link
                    </a>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-red-200 hover:text-red-700"
                        hx-delete={`/_admin/files/object?key=${encodeURIComponent(
                            entry.key,
                        )}`}
                        hx-target="#file-content"
                        hx-swap="outerHTML"
                        hx-confirm={`Delete ${entry.name}?`}
                    >
                        <Spinner class="h-3 w-3" />
                        delete
                    </button>
                </div>
            </td>
        </tr>
    );
};

const CreateFolderForm: FC<{ parent: string }> = ({ parent }) => (
    <form
        hx-post="/_admin/files/folder"
        hx-target="#file-content"
        hx-swap="outerHTML"
        hx-on--after-request="if(event.detail.successful) this.reset()"
        class="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3"
    >
        <input
            type="hidden"
            name="parent"
            value={parent}
        />
        <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">
                New folder in {parent || 'root'}
            </span>
            <input
                type="text"
                name="name"
                required
                placeholder="folder-name"
                class="w-64 rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
            />
        </label>
        <button
            type="submit"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm hover:bg-zinc-50"
        >
            <Spinner class="h-3.5 w-3.5" />
            Create folder
        </button>
    </form>
);

const UploadDropzone: FC<{ prefix: string }> = ({ prefix }) => (
    <form
        id="upload-form"
        hx-post="/_admin/files/upload"
        hx-encoding="multipart/form-data"
        hx-target="#file-content"
        hx-swap="outerHTML"
        hx-on--after-request="if(event.detail.successful) this.reset()"
        class="mb-3"
        data-dropzone
    >
        <input
            type="hidden"
            name="prefix"
            value={prefix}
        />
        <label class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 bg-white px-4 py-8 text-center transition hover:border-zinc-900 hover:bg-zinc-50">
            <span class="text-sm font-medium text-zinc-900">
                Drop files here or click to browse
            </span>
            <span class="text-xs text-zinc-500">
                Upload to {prefix || 'root'} · max ~95MB per file
            </span>
            <input
                type="file"
                name="files"
                multiple
                required
                class="sr-only"
                onchange="if(this.files.length){window.htmx?window.htmx.trigger(this.form,'submit'):this.form.requestSubmit()}"
            />
            <Spinner class="mt-1 h-4 w-4 text-zinc-500" />
        </label>
        <progress
            data-upload-progress
            class="mt-2 hidden w-full"
            value="0"
            max="100"
        ></progress>
    </form>
);

const PageLink: FC<{ href?: string; label: string }> = ({ href, label }) => {
    const cls =
        'rounded border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-100';
    if (!href) {
        return (
            <span class={`${cls} cursor-not-allowed text-zinc-300`}>
                {label}
            </span>
        );
    }
    return (
        <a
            href={href}
            class={cls}
        >
            {label}
        </a>
    );
};
