import type { FC } from 'hono/jsx';
import { Layout } from './layout';
import { FileList } from './file-list';
import type { ListedEntry } from '../files';
import { Spinner } from './components/spinner';

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

export const FilesPage: FC<Props> = props => (
    <Layout title="Files — habits-linker">
        <main class="mx-auto max-w-5xl px-4 py-8">
            <header class="mb-6 flex items-center justify-between">
                <h1 class="text-xl font-semibold tracking-tight">Files</h1>
                <div class="flex items-center gap-3 text-sm">
                    <a
                        href="/_admin"
                        class="text-zinc-500 hover:text-zinc-900"
                    >
                        Share links
                    </a>
                    <form
                        method="post"
                        action="/_admin/logout"
                    >
                        <button class="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900">
                            <Spinner />
                            Sign out
                        </button>
                    </form>
                </div>
            </header>

            <FileList {...props} />

            <script
                src="/admin.js"
                defer
            ></script>
        </main>
    </Layout>
);
