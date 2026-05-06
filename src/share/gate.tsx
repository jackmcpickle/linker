import type { Context, MiddlewareHandler } from "hono";
import type { ShareEnv, ShareLink } from "../types";
import { getLink } from "../kv/links";
import { isValidToken } from "../lib/nanoid";
import { ExpiredPage } from "./views/expired";
import { log } from "../lib/log";

export type GateResult =
  | { kind: "ok"; link: ShareLink }
  | { kind: "missing" }
  | { kind: "revoked"; link: ShareLink }
  | { kind: "expired"; link: ShareLink };

export async function evaluateToken(
  kv: KVNamespace,
  token: string,
  now: number,
): Promise<GateResult> {
  if (!isValidToken(token)) return { kind: "missing" };
  const link = await getLink(kv, token);
  if (!link) return { kind: "missing" };
  if (link.revokedAt) return { kind: "revoked", link };
  if (link.expiresAt <= now) return { kind: "expired", link };
  return { kind: "ok", link };
}

/** Render the bare expiry page; identical body for missing/revoked/expired. */
export async function expiryResponse<C extends { html: Context["html"] }>(
  c: C,
  kind: "missing" | "revoked" | "expired",
): Promise<Response> {
  // 404 for never-existed; 410 for previously-valid (expired/revoked)
  const status = kind === "missing" ? 404 : 410;
  return c.html(<ExpiredPage />, status, {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex,nofollow",
  });
}

/** Middleware: gate the request on a valid token; reject otherwise with the expiry page. */
export const shareGate: MiddlewareHandler<ShareEnv> = async (c, next) => {
  const token = c.get("token");
  const result = await evaluateToken(c.env.LINKS, token, Date.now());

  if (result.kind === "ok") {
    c.set("link", result.link);
    await next();
    return;
  }

  log({ event: "share.gate.reject", token, kind: result.kind });
  return expiryResponse(c, result.kind);
};
