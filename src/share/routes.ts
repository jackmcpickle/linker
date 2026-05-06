import { Hono } from "hono";
import type { Env } from "../types";
import { classifyHost } from "../lib/dispatch";

type ShareEnv = Env & { Variables: { token: string } };

const share = new Hono<ShareEnv>();

// Parse token from Host. Dispatcher already verified it's a share host,
// but we re-classify here so this app is self-contained and testable.
share.use("*", async (c, next) => {
  const host = c.req.header("host") ?? "";
  const cls = classifyHost(host, c.env.SHARE_DOMAIN);
  if (cls.kind !== "share") return c.text("not a share host", 400);
  c.set("token", cls.token);
  await next();
});

share.all("*", (c) => {
  const token = c.get("token");
  const path = new URL(c.req.url).pathname;
  return c.text(`share token=${token} path=${path} (real serving comes in stages 7-10)`);
});

export default share;
