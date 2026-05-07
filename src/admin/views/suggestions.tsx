import type { FC } from 'hono/jsx';

type Props = {
    folders: string[];
    files: string[];
    q: string;
};

export const Suggestions: FC<Props> = ({ folders, files, q }) => {
    if (!q) return <span></span>;

    const empty = folders.length === 0 && files.length === 0;
    if (empty) {
        return <span class="text-zinc-400 italic">no matches for {q}</span>;
    }

    return (
        <div class="space-y-1.5 rounded-md border border-zinc-200 bg-white p-2">
            {folders.length > 0 ? (
                <div>
                    <div class="px-2 py-0.5 text-[10px] tracking-wider text-zinc-400 uppercase">
                        Folders
                    </div>
                    <ul>
                        {folders.map(f => (
                            <li>
                                <button
                                    type="button"
                                    data-suggestion={f}
                                    class="block w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-zinc-100"
                                >
                                    {f}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {files.length > 0 ? (
                <div>
                    <div class="px-2 py-0.5 text-[10px] tracking-wider text-zinc-400 uppercase">
                        Files
                    </div>
                    <ul>
                        {files.map(f => (
                            <li>
                                <button
                                    type="button"
                                    data-suggestion={f}
                                    class="block w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-zinc-100"
                                >
                                    {f}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};
