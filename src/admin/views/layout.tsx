import type { FC, PropsWithChildren } from 'hono/jsx';
import { ToastRegion } from './components/toast';

type Props = PropsWithChildren<{ title: string; turnstileSiteKey?: string }>;

export const Layout: FC<Props> = ({ title, turnstileSiteKey, children }) => (
    <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="robots" content="noindex,nofollow" />
            <title>{title}</title>
            <link rel="stylesheet" href="/style.css" />
            <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
            {turnstileSiteKey ? (
                <script
                    src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                    async
                    defer
                ></script>
            ) : null}
        </head>
        <body class="min-h-dvh bg-zinc-50 text-zinc-900 antialiased">
            {children}
            <ToastRegion />
        </body>
    </html>
);
