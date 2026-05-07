import type { FC } from 'hono/jsx';
import { DEFAULT_PRESET, EXPIRY_PRESETS } from '../../lib/expiry';
import { Spinner } from './components/spinner';

export const CreateLinkForm: FC = () => (
    <form
        id="create-form"
        hx-post="/_admin/links"
        hx-target="#links-list"
        hx-swap="outerHTML"
        hx-on--after-request="if(event.target===this && event.detail.successful) this.reset()"
        class="rounded-xl border border-zinc-200 bg-white p-5 mb-6 grid gap-3"
    >
        <div class="grid gap-3 md:grid-cols-2">
            <label class="block">
                <span class="block text-xs text-zinc-500 mb-1">Name</span>
                <input
                    type="text"
                    name="name"
                    required
                    placeholder="e.g. Acme Q4 review"
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
            </label>
            <label class="block">
                <span class="block text-xs text-zinc-500 mb-1">R2 prefix</span>
                <input
                    type="text"
                    name="prefix"
                    required
                    placeholder="clients/acme-2026/"
                    autocomplete="off"
                    class="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
                    hx-get="/_admin/prefixes"
                    hx-trigger="input changed delay:200ms, focus"
                    hx-target="#prefix-suggestions"
                    hx-swap="innerHTML"
                    hx-params="prefix"
                />
                <div id="prefix-suggestions" class="mt-1 text-xs text-zinc-500"></div>
            </label>
        </div>

        <label class="block">
            <span class="block text-xs text-zinc-500 mb-1">Notes (optional)</span>
            <input
                type="text"
                name="notes"
                placeholder="internal note"
                class="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
        </label>

        <fieldset>
            <legend class="block text-xs text-zinc-500 mb-1">Expires</legend>
            <div class="flex flex-wrap gap-1.5">
                {EXPIRY_PRESETS.map((p) => (
                    <label class="cursor-pointer">
                        <input
                            type="radio"
                            name="preset"
                            value={p.id}
                            required
                            checked={p.id === DEFAULT_PRESET}
                            class="peer sr-only"
                        />
                        <span class="block rounded-md border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50 peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white">
                            {p.id}
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>

        <div>
            <button
                type="submit"
                class="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
                <Spinner />
                Create share link
            </button>
        </div>
    </form>
);
