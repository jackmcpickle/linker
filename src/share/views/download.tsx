import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import { Spinner } from '../../admin/views/components/spinner';

const DOWNLOAD_SCRIPT = `
(function(){
  var DOWNLOAD_BUSY_MS = 6000;
  document.querySelectorAll('[data-download-action]').forEach(function(el){
    el.addEventListener('click', function(e){
      if (el.classList.contains('htmx-request')) { e.preventDefault(); return; }
      var url = el.getAttribute('href');
      if (!url) return;
      e.preventDefault();
      el.classList.add('htmx-request');
      var a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ el.classList.remove('htmx-request'); }, DOWNLOAD_BUSY_MS);
    });
  });
  window.addEventListener('pagehide', function(){
    document.querySelectorAll('[data-download-action].htmx-request').forEach(function(el){
      el.classList.remove('htmx-request');
    });
  });
})();
`;

type Props = {
    name: string;
    /** Display label shown above the button (e.g. file name or folder name). */
    target: string;
    /** Set when a download attempt failed and we want to surface a message. */
    error?: string;
    /** Where the button POSTs/GETs to. */
    actionHref: string;
};

export const DownloadPage: FC<Props> = ({
    name,
    target,
    error,
    actionHref,
}) => (
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
            <title>Download — {name}</title>
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
        .card {
          border: 1px solid #e4e4e7;
          border-radius: 0.5rem;
          padding: 1.5rem;
          background: white;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 1rem;
        }
        .target {
          color: #71717a;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875rem;
          word-break: break-all;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 1rem;
          border-radius: 0.375rem;
          background: #18181b;
          color: white;
          text-decoration: none;
          font-size: 0.875rem;
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-weight: 500;
        }
        .btn:hover { background: #27272a; }
        .err {
          color: #b91c1c;
          font-size: 0.875rem;
          padding: 0.5rem 0.75rem;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 0.375rem;
        }
        .htmx-spinner { display: none; }
        .htmx-request .htmx-spinner,
        .htmx-request.htmx-spinner { display: inline-block; }
        a.btn.htmx-request {
          pointer-events: none;
          opacity: 0.7;
        }
        .htmx-spinner { width: 1rem; height: 1rem; margin-right: 0.25rem; }
        @media (prefers-color-scheme: dark) {
          body { background: #09090b; color: #e4e4e7; }
          .card { background: #18181b; border-color: #27272a; }
          .target { color: #a1a1aa; }
          .btn { background: #e4e4e7; color: #18181b; }
          .btn:hover { background: #d4d4d8; }
          .err { background: #2a1313; border-color: #7f1d1d; color: #fca5a5; }
        }
      `}</style>
        </head>
        <body>
            <main>
                <h1>{name}</h1>
                <div class="card">
                    <div class="target">{target}</div>
                    {error ? <div class="err">{error}</div> : null}
                    {!error ? (
                        <a
                            class="btn"
                            href={actionHref}
                            data-download-action
                        >
                            <Spinner />
                            Download
                        </a>
                    ) : null}
                </div>
            </main>
            <script>{raw(DOWNLOAD_SCRIPT)}</script>
        </body>
    </html>
);
