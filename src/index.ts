import type { Bindings } from "./types";
import adminApp from "./admin/routes";
import shareApp from "./share/routes";
import { classifyHost } from "./lib/dispatch";
import { log } from "./lib/log";

export default {
  async fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/health") return new Response("ok");

      const host = req.headers.get("host") ?? "";
      const cls = classifyHost(host, env.SHARE_DOMAIN);

      switch (cls.kind) {
        case "admin":
          return await adminApp.fetch(req, env, ctx);
        case "share":
          return await shareApp.fetch(req, env, ctx);
        default:
          return new Response(`unknown host: ${host}`, { status: 404 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      log({ event: "fetch.error", message, stack });
      return new Response("internal error", {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
