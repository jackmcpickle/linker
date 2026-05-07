import type { FC } from 'hono/jsx';

export type ToastLevel = 'success' | 'error';

type Props = { level: ToastLevel; message: string };

const levelClass: Record<ToastLevel, string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-red-200 bg-red-50 text-red-900',
};

// A single toast, wrapped in an OOB swap container that replaces the
// contents of #toast-region. Errors persist; successes auto-dismiss.
export const Toast: FC<Props> = ({ level, message }) => (
    <div
        id="toast-region"
        hx-swap-oob="innerHTML"
    >
        <div
            class={`toast pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm ${levelClass[level]}`}
            data-toast-level={level}
            data-auto-dismiss={level === 'success' ? 'true' : undefined}
            role={level === 'error' ? 'alert' : 'status'}
        >
            <span class="flex-1">{message}</span>
            <button
                type="button"
                class="-mt-0.5 -mr-1 px-1 text-current opacity-60 hover:opacity-100"
                data-toast-dismiss
                aria-label="Dismiss"
            >
                ×
            </button>
        </div>
    </div>
);

export const ToastRegion: FC = () => (
    <div
        id="toast-region"
        class="pointer-events-none fixed top-4 right-4 z-50 w-80 max-w-[calc(100%-2rem)]"
    ></div>
);
