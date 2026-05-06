import type { FC } from "hono/jsx";

export type ListingEntry = {
  name: string;
  href: string;
  kind: "folder" | "file";
  size?: number;
};

type Props = {
  path: string;
  parentHref?: string;
  entries: ListingEntry[];
};

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export const ListingPage: FC<Props> = ({ path, parentHref, entries }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex,nofollow" />
      <title>Index of {path}</title>
      <style>{`
        :root { color-scheme: light dark; }
        body {
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          margin: 0;
          padding: 1.5rem;
          background: #fafafa;
          color: #18181b;
        }
        main { max-width: 56rem; margin: 0 auto; }
        h1 {
          font-weight: 500;
          font-size: 1rem;
          letter-spacing: -0.01em;
          margin: 0 0 0.75rem 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          word-break: break-all;
        }
        ul { list-style: none; padding: 0; margin: 0; border-top: 1px solid #e4e4e7; }
        li { border-bottom: 1px solid #e4e4e7; }
        a {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.5rem;
          color: inherit;
          text-decoration: none;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875rem;
        }
        a:hover { background: #f4f4f5; }
        .name { flex: 1; }
        .size { color: #71717a; font-size: 0.75rem; }
        .kind { color: #a1a1aa; width: 1.25rem; text-align: center; }
        .empty { color: #71717a; padding: 1rem 0.5rem; font-size: 0.875rem; }
        @media (prefers-color-scheme: dark) {
          body { background: #09090b; color: #e4e4e7; }
          ul, li { border-color: #27272a; }
          a:hover { background: #18181b; }
          .size, .empty { color: #a1a1aa; }
          .kind { color: #71717a; }
        }
      `}</style>
    </head>
    <body>
      <main>
        <h1>Index of {path}</h1>
        <ul>
          {parentHref ? (
            <li>
              <a href={parentHref}>
                <span class="kind">↑</span>
                <span class="name">../</span>
              </a>
            </li>
          ) : null}
          {entries.length === 0 && !parentHref ? (
            <li class="empty">empty folder</li>
          ) : null}
          {entries.map((e) => (
            <li>
              <a href={e.href}>
                <span class="kind">{e.kind === "folder" ? "▸" : "·"}</span>
                <span class="name">
                  {e.name}
                  {e.kind === "folder" ? "/" : ""}
                </span>
                <span class="size">{fmtSize(e.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </body>
  </html>
);
