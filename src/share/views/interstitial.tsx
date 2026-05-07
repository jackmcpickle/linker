import type { FC } from 'hono/jsx';

type Props = {
    turnstileSiteKey: string;
    next: string;
};

export const InterstitialPage: FC<Props> = ({ turnstileSiteKey, next }) => (
    <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="robots" content="noindex,nofollow" />
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
        .card {
          padding: 1.25rem 1.5rem;
          border-radius: 0.75rem;
          background: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          font-size: 0.875rem;
          color: #71717a;
        }
        @media (prefers-color-scheme: dark) {
          body { background: #09090b; color: #e4e4e7; }
          .card { background: #18181b; }
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
                <input type="hidden" name="next" value={next} />
                <div class="card">Verifying…</div>
                <div id="ts-container" style="margin-top:0.75rem;"></div>
            </form>
            <script src="/__challenge.js" defer></script>
        </body>
    </html>
);
