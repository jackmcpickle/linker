import type { FC } from 'hono/jsx';

type Props = {
    turnstileSiteKey: string;
    next: string;
};

export const InterstitialPage: FC<Props> = ({ turnstileSiteKey, next }) => (
    <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
            />
            <meta
                name="robots"
                content="noindex,nofollow"
            />
            <title>Verifying…</title>
            <style>{`
        :root { color-scheme: light dark; }
        body {
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          display: grid;
          place-items: center;
          min-height: 100dvh;
          margin: 0;
          background: #fafafa;
          color: #18181b;
        }
        #ts-form {
          display: grid;
          justify-items: center;
          gap: 1rem;
          max-width: 28rem;
          padding: 1.5rem;
          text-align: center;
        }
        #ts-status, #ts-fallback { font-size: 0.9375rem; line-height: 1.5; }
        #ts-fallback p { margin: 0 0 0.75rem; }
        #ts-fallback p:last-child { margin-bottom: 0; }
        .muted { color: #71717a; }
        @media (prefers-color-scheme: dark) {
          body { background: #09090b; color: #e4e4e7; }
          .muted { color: #a1a1aa; }
        }
      `}</style>
            <script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                async
                defer
            ></script>
        </head>
        <body>
            <form
                id="ts-form"
                method="post"
                action="/__verify"
                data-turnstile-site-key={turnstileSiteKey}
            >
                <input
                    type="hidden"
                    name="next"
                    value={next}
                />
                <div id="ts-container"></div>
                <div id="ts-status">Verifying your browser…</div>
                <div
                    id="ts-fallback"
                    hidden
                >
                    <p>We couldn't verify your browser.</p>
                    <p class="muted">
                        If your organisation uses secure or isolated browsing,
                        try opening this link outside it, or in a different
                        browser. If it still doesn't work, get in touch with
                        whoever shared the link.
                    </p>
                </div>
                <noscript>
                    <div class="muted">
                        This page needs JavaScript enabled to verify your
                        browser.
                    </div>
                </noscript>
            </form>
            <script
                src="/__challenge.js"
                defer
            ></script>
        </body>
    </html>
);
