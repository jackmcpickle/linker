import { Hono } from "hono";
import type { ShareEnv } from "../types";
import { classifyHost } from "../lib/dispatch";
import { shareGate } from "./gate";
import { buildShareCookie, hasValidShareCookie } from "./cookie";
import { InterstitialPage } from "./views/interstitial";
import { verifyTurnstile } from "../lib/turnstile";

const share = new Hono<ShareEnv>();

// Asset passthrough — the challenge bootstrap script only.
// Other admin assets are not exposed on share subdomains.
share.get("/__challenge.js", async (c) => c.env.ASSETS.fetch(c.req.raw));

// Parse token from Host.
share.use("*", async (c, next) => {
  const host = c.req.header("host") ?? "";
  const cls = classifyHost(host, c.env.SHARE_DOMAIN);
  if (cls.kind !== "share") return c.text("not a share host", 400);
  c.set("token", cls.token);
  await next();
});

// Token gate — KV lookup; expired/revoked/missing → bare expiry page.
share.use("*", shareGate);

// Verify endpoint — POST'ed by the interstitial after Turnstile solves.
share.post("/__verify", async (c) => {
  const link = c.get("link");
  const form = await c.req.formData();
  const tsToken = String(form.get("cf-turnstile-response") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));

  const ts = await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET_KEY, clientIp(c));
  if (!ts.ok) return c.text("verification failed", 400, { "Cache-Control": "no-store" });

  const cookie = await buildShareCookie(c, link, c.env.COOKIE_HMAC_SECRET);
  if (!cookie) return c.text("share expired", 410, { "Cache-Control": "no-store" });

  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
});

// Recipient cookie gate — render interstitial if cookie missing/invalid.
share.use("*", async (c, next) => {
  const link = c.get("link");
  const ok = await hasValidShareCookie(c, link.token, c.env.COOKIE_HMAC_SECRET);
  if (ok) return next();

  const url = new URL(c.req.url);
  return c.html(
    <InterstitialPage turnstileSiteKey={c.env.TURNSTILE_SITE_KEY} next={url.pathname + url.search} />,
    200,
    { "Cache-Control": "no-store" },
  );
});

// Stage 8 placeholder — R2 fetch lands in stage 9.
share.all("*", (c) => {
  const link = c.get("link");
  const path = new URL(c.req.url).pathname;
  return c.text(
    `validated share — token=${link.token} prefix=${link.prefix} path=${path}\n` +
      `(R2 fetch in stage 9)`,
  );
});

// ---------- helpers ----------

function safeNext(input: string): string {
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/"; // protocol-relative bypass
  if (input.includes("\n") || input.includes("\r")) return "/"; // header injection
  return input;
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  return c.req.header("cf-connecting-ip");
}

export default share;
