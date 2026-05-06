import type { Bindings } from "./types";
import adminApp from "./admin/routes";
import shareApp from "./share/routes";
import { classifyHost } from "./lib/dispatch";

export default {
  async fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");

    const host = req.headers.get("host") ?? "";
    const cls = classifyHost(host, env.SHARE_DOMAIN);

    switch (cls.kind) {
      case "admin":
        return adminApp.fetch(req, env, ctx);
      case "share":
        return shareApp.fetch(req, env, ctx);
      default:
        return new Response(`unknown host: ${host}`, { status: 404 });
    }
  },
};
