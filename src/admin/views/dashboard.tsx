import type { FC } from 'hono/jsx';
import { Layout } from './layout';
import type { ShareLink } from '../../types';
import { LinkRow } from './link-row';
import { CreateLinkForm } from './link-form';
import { Spinner } from './components/spinner';

type Props = {
    links: ShareLink[];
    shareDomain: string;
    defaultPrefix?: string;
};

export const DashboardPage: FC<Props> = ({
    links,
    shareDomain,
    defaultPrefix,
}) => (
    <Layout title="Dashboard — habits-linker">
        <main class="mx-auto max-w-5xl px-4 py-8">
            <header class="mb-6 flex items-center justify-between">
                <h1 class="text-xl font-semibold tracking-tight">
                    Share links
                </h1>
                <div class="flex items-center gap-3 text-sm">
                    <a
                        href="/_admin/files"
                        class="text-zinc-500 hover:text-zinc-900"
                    >
                        Browse files
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

            <CreateLinkForm defaultPrefix={defaultPrefix} />

            <LinkList
                links={links}
                shareDomain={shareDomain}
            />

            <script
                src="/admin.js"
                defer
            ></script>
        </main>
    </Layout>
);

export const LinkList: FC<Props> = ({ links, shareDomain }) => (
    <div id="links-list">
        {links.length === 0 ? (
            <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
                No share links yet — create one above.
            </div>
        ) : (
            <div class="rounded-xl border border-zinc-200 bg-white">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs tracking-wider text-zinc-500 uppercase">
                            <th class="px-4 py-2 font-medium">Link</th>
                            <th class="px-4 py-2 font-medium">URL</th>
                            <th class="px-4 py-2 font-medium">Status</th>
                            <th class="px-4 py-2 font-medium">Activity</th>
                            <th class="px-4 py-2 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {links.map(link => (
                            <LinkRow
                                link={link}
                                shareDomain={shareDomain}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);
