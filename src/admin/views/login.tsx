import type { FC } from 'hono/jsx';
import { Layout } from './layout';

type Props = {
    turnstileSiteKey: string;
    error?: string;
    lockedUntil?: number;
};

export const LoginPage: FC<Props> = ({ turnstileSiteKey, error, lockedUntil }) => (
    <Layout title="Sign in — habits-linker" turnstileSiteKey={turnstileSiteKey}>
        <main class="grid place-items-center min-h-dvh px-4">
            <form
                id="login-form"
                method="post"
                action="/_admin/login"
                data-turnstile-site-key={turnstileSiteKey}
                class="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
                <h1 class="text-lg font-semibold tracking-tight">habits-linker</h1>
                <p class="text-sm text-zinc-500">Sign in to manage share links.</p>

                <label class="block">
                    <span class="block text-sm font-medium mb-1">Password</span>
                    <input
                        type="password"
                        name="password"
                        required
                        autofocus
                        autocomplete="current-password"
                        class="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
                    />
                </label>

                {error ? (
                    <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                ) : null}
                {lockedUntil ? (
                    <p
                        class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700"
                        data-locked-until={lockedUntil}
                    >
                        Too many attempts. Try again later.
                    </p>
                ) : null}

                <div id="ts-container"></div>

                <button
                    type="submit"
                    class="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                    Sign in
                </button>
            </form>

            <script src="/login.js" defer></script>
        </main>
    </Layout>
);
