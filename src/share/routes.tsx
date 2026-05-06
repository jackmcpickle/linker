import { Hono } from "hono";
import type { ShareEnv } from "../types";
import { classifyHost } from "../lib/dispatch";
import { shareGate } from "./gate";

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

// Token gate — KV lookup, returns expiry page on missing/revoked/expired.
share.use("*", shareGate);

// Stage 7 placeholder — real serving (interstitial, R2 fetch, listing) lands in 8-10.
share.all("*", (c) => {
  const link = c.get("link");
  const path = new URL(c.req.url).pathname;
  return c.text(
    `valid share — token=${link.token} prefix=${link.prefix} path=${path}\n` +
      `(turnstile interstitial in stage 8, R2 fetch in stage 9)`,
  );
});

export default share;
