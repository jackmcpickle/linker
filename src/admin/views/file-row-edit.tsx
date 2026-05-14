import type { FC } from 'hono/jsx';
import type { ListedEntry } from '../files';
import { listUrl } from './file-list-url';
import { Spinner } from './components/spinner';

function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function rowId(key: string): string {
    return `row-${btoa(key).replace(/[^a-zA-Z0-9]/g, '')}`;
}

export const FolderRowStatic: FC<{
    entry: Extract<ListedEntry, { kind: 'folder' }>;
    prefix: string;
}> = ({ entry, prefix }) => {
    const childPrefix = `${prefix}${entry.name}/`;
    const id = rowId(childPrefix);
    return (
        <tr
            id={id}
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
            <td class="px-2 py-2 text-right text-xs text-zinc-400">folder</td>
            <td class="px-4 py-2 text-right">
                <div class="inline-flex items-center gap-1.5">
                    <a
                        href={`/_admin?prefix=${encodeURIComponent(childPrefix)}#create-form`}
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        title="Create share link for this folder"
                    >
                        + link
                    </a>
                    <a
                        href={`/_admin/files/folder/download?prefix=${encodeURIComponent(childPrefix)}`}
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        title="Download folder as .zip (max 1000 items)"
                    >
                        download
                    </a>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        hx-get={`/_admin/files/folder/edit?prefix=${encodeURIComponent(childPrefix)}`}
                        hx-target={`#${id}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner class="h-3 w-3" />
                        rename
                    </button>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-red-200 hover:text-red-700"
                        hx-delete={`/_admin/files/folder?prefix=${encodeURIComponent(childPrefix)}`}
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
};

export const FileRowStatic: FC<{
    entry: Extract<ListedEntry, { kind: 'file' }>;
    prefix: string;
}> = ({ entry }) => {
    const id = rowId(entry.key);
    return (
        <tr
            id={id}
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
                        href={`/_admin?prefix=${encodeURIComponent(entry.key)}#create-form`}
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        title="Create share link for this file"
                    >
                        + link
                    </a>
                    <a
                        href={`/_admin/files/object/download?key=${encodeURIComponent(entry.key)}`}
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        title={`Download ${entry.name}`}
                    >
                        download
                    </a>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-900 hover:text-zinc-900"
                        hx-get={`/_admin/files/object/edit?key=${encodeURIComponent(entry.key)}`}
                        hx-target={`#${id}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner class="h-3 w-3" />
                        rename
                    </button>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 hover:border-red-200 hover:text-red-700"
                        hx-delete={`/_admin/files/object?key=${encodeURIComponent(entry.key)}`}
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

export const FileRowEdit: FC<{
    name: string;
    objectKey: string;
    prefix: string;
}> = ({ name, objectKey, prefix: _prefix }) => {
    const id = rowId(objectKey);
    return (
        <tr
            id={id}
            class="border-b border-zinc-50 bg-zinc-50 last:border-b-0"
        >
            <td
                colspan={4}
                class="px-4 py-2"
            >
                <form
                    hx-patch="/_admin/files/object"
                    hx-target="#file-content"
                    hx-swap="outerHTML"
                    class="flex flex-wrap items-center gap-2"
                >
                    <input
                        type="hidden"
                        name="key"
                        value={objectKey}
                    />
                    <label class="flex-1">
                        <span class="mb-1 block text-xs text-zinc-500">
                            Rename file
                        </span>
                        <input
                            type="text"
                            name="newName"
                            value={name}
                            required
                            autofocus
                            class="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
                        />
                    </label>
                    <button
                        type="submit"
                        class="inline-flex items-center gap-1 self-end rounded-md bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-800"
                    >
                        <Spinner class="h-3 w-3" />
                        Save
                    </button>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 self-end rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
                        hx-get={`/_admin/files/object/row?key=${encodeURIComponent(objectKey)}`}
                        hx-target={`#${id}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner class="h-3 w-3" />
                        Cancel
                    </button>
                </form>
            </td>
        </tr>
    );
};

export const FolderRowEdit: FC<{
    name: string;
    prefix: string;
    parent: string;
}> = ({ name, prefix, parent: _parent }) => {
    const id = rowId(prefix);
    return (
        <tr
            id={id}
            class="border-b border-zinc-50 bg-zinc-50 last:border-b-0"
        >
            <td
                colspan={4}
                class="px-4 py-2"
            >
                <form
                    hx-patch="/_admin/files/folder"
                    hx-target="#file-content"
                    hx-swap="outerHTML"
                    class="flex flex-wrap items-center gap-2"
                >
                    <input
                        type="hidden"
                        name="prefix"
                        value={prefix}
                    />
                    <label class="flex-1">
                        <span class="mb-1 block text-xs text-zinc-500">
                            Rename folder (max 1000 items)
                        </span>
                        <input
                            type="text"
                            name="newName"
                            value={name}
                            required
                            autofocus
                            class="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
                        />
                    </label>
                    <button
                        type="submit"
                        class="inline-flex items-center gap-1 self-end rounded-md bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-800"
                    >
                        <Spinner class="h-3 w-3" />
                        Save
                    </button>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 self-end rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
                        hx-get={`/_admin/files/folder/row?prefix=${encodeURIComponent(prefix)}`}
                        hx-target={`#${id}`}
                        hx-swap="outerHTML"
                    >
                        <Spinner class="h-3 w-3" />
                        Cancel
                    </button>
                </form>
            </td>
        </tr>
    );
};
