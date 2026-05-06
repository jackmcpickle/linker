import { Hono } from "hono";
import type { Env } from "../types";
import { LoginPage } from "./views/login";
import { DashboardPage } from "./views/dashboard";
import {
  clearSessionCookie,
  clientIp,
  isAuthed,
  requireAuth,
  setSessionCookie,
} from "./auth";
import {
  checkLoginThrottle,
  clearLoginFailures,
  recordLoginFailure,
} from "../lib/throttle";
import { verifyTurnstile } from "../lib/turnstile";

const admin = new Hono<Env>();

// Static asset passthrough — login.js, etc. served from /public via ASSETS binding.
admin.get("/login.js", async (c) => c.env.ASSETS.fetch(c.req.raw));
admin.get("/style.css", async (c) => c.env.ASSETS.fetch(c.req.raw));
admin.get("/favicon.ico", async (c) => c.env.ASSETS.fetch(c.req.raw));

admin.get("/", (c) => c.redirect("/_admin", 303));

admin.get("/_admin", async (c) => {
  if (await isAuthed(c)) return c.html(<DashboardPage />);
  return c.html(<LoginPage turnstileSiteKey={c.env.TURNSTILE_SITE_KEY} />);
});

admin.post("/_admin/login", async (c) => {
  const ip = clientIp(c);
  const now = Date.now();

  const throttle = await checkLoginThrottle(c.env.THROTTLE, ip, now);
  if (!throttle.allowed) {
    return c.html(
      <LoginPage
        turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
        lockedUntil={throttle.lockedUntil}
      />,
      429,
    );
  }

  const form = await c.req.formData();
  const password = String(form.get("password") ?? "");
  const tsToken = String(form.get("cf-turnstile-response") ?? "");

  const ts = await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET_KEY, ip);
  if (!ts.ok) {
    await recordLoginFailure(c.env.THROTTLE, ip, now);
    return c.html(
      <LoginPage
        turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
        error="Verification failed. Try again."
      />,
      400,
    );
  }

  // Constant-time password compare. Both fixed-length is best, but in practice
  // string compare with timing-safe XOR is fine vs. an attacker without local access.
  if (!constantTimeEqual(password, c.env.ADMIN_PASSWORD)) {
    const recorded = await recordLoginFailure(c.env.THROTTLE, ip, now);
    if (!recorded.allowed) {
      return c.html(
        <LoginPage
          turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
          lockedUntil={recorded.lockedUntil}
        />,
        429,
      );
    }
    return c.html(
      <LoginPage
        turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
        error="Incorrect password."
      />,
      401,
    );
  }

  await clearLoginFailures(c.env.THROTTLE, ip);
  await setSessionCookie(c);
  return c.redirect("/_admin", 303);
});

admin.post("/_admin/logout", async (c) => {
  clearSessionCookie(c);
  return c.redirect("/_admin", 303);
});

// Authed routes — placeholder; real CRUD comes in stage 5.
admin.use("/_admin/*", requireAuth);
admin.get("/_admin/dashboard", (c) => c.html(<DashboardPage />));

admin.all("*", (c) => c.text("not found", 404));

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default admin;
