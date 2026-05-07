import type { FC } from 'hono/jsx';

type Props = { class?: string };

export const Spinner: FC<Props> = ({ class: cls = 'h-3.5 w-3.5' }) => (
    <svg
        class={`htmx-spinner inline-block animate-spin ${cls}`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
    >
        <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-opacity="0.25"
            stroke-width="4"
        />
        <path
            d="M4 12a8 8 0 0 1 8-8"
            stroke="currentColor"
            stroke-width="4"
            stroke-linecap="round"
        />
    </svg>
);
