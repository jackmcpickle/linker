import type { FC } from "hono/jsx";

export const ExpiredPage: FC = () => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <title>Link expired</title>
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
        h1 { font-weight: 400; font-size: 1.25rem; letter-spacing: -0.01em; }
        @media (prefers-color-scheme: dark) {
          body { background: #09090b; color: #e4e4e7; }
        }
      `}</style>
    </head>
    <body>
      <h1>This link has expired</h1>
    </body>
  </html>
);
