import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const DashboardPage: FC = () => (
  <Layout title="Dashboard — habits-linker">
    <main class="mx-auto max-w-4xl px-4 py-8">
      <header class="mb-6 flex items-center justify-between">
        <h1 class="text-xl font-semibold tracking-tight">Share links</h1>
        <form method="post" action="/_admin/logout">
          <button class="text-sm text-zinc-500 hover:text-zinc-900">Sign out</button>
        </form>
      </header>
      <section class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
        Authenticated. CRUD UI lands in stage 5.
      </section>
    </main>
  </Layout>
);
