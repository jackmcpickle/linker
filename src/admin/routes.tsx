import { Hono } from "hono";
import type { Env, ShareLink } from "../types";
import { LoginPage } from "./views/login";
import { DashboardPage, LinkList } from "./views/dashboard";
import { LinkRow } from "./views/link-row";
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
import { getLink, listLinks, putLink, deleteLink } from "../kv/links";
import { generateToken, isValidToken } from "../lib/nanoid";
import { presetMs } from "../lib/expiry";
import { Suggestions } from "./views/suggestions";

const admin = new Hono<Env>();

// ---------- static asset passthrough ----------
admin.get("/login.js", async (c) => c.env.ASSETS.fetch(c.req.raw));
admin.get("/admin.js", async (c) => c.env.ASSETS.fetch(c.req.raw));
admin.get("/style.css", async (c) => c.env.ASSETS.fetch(c.req.raw));
admin.get("/favicon.ico", async (c) => c.env.ASSETS.fetch(c.req.raw));

// ---------- public routes (login) ----------
admin.get("/", (c) => c.redirect("/_admin", 303));

admin.get("/_admin", async (c) => {
  if (await isAuthed(c)) {
    const links = await listLinks(c.env.LINKS);
    return c.html(<DashboardPage links={links} shareDomain={c.env.SHARE_DOMAIN} />);
  }
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

// ---------- authed routes ----------
admin.use("/_admin/*", requireAuth);

// list fragment (HTMX target after mutations)
admin.get("/_admin/links", async (c) => {
  const links = await listLinks(c.env.LINKS);
  return c.html(<LinkList links={links} shareDomain={c.env.SHARE_DOMAIN} />);
});

// create
admin.post("/_admin/links", async (c) => {
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const prefix = normalizePrefix(String(form.get("prefix") ?? ""));
  const notes = String(form.get("notes") ?? "").trim() || undefined;
  const presetId = String(form.get("preset") ?? "");
  const ms = presetMs(presetId);

  if (!name || !prefix || ms === null) {
    return c.text("invalid input", 400);
  }

  const now = Date.now();
  const link: ShareLink = {
    token: generateToken(),
    name,
    notes,
    prefix,
    createdAt: now,
    expiresAt: now + ms,
    viewCount: 0,
  };
  await putLink(c.env.LINKS, link);

  const links = await listLinks(c.env.LINKS);
  return c.html(<LinkList links={links} shareDomain={c.env.SHARE_DOMAIN} />);
});

// single row (used by Cancel on edit form)
admin.get("/_admin/links/:token", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  const link = await getLink(c.env.LINKS, token);
  if (!link) return c.text("not found", 404);
  return c.html(<LinkRow link={link} shareDomain={c.env.SHARE_DOMAIN} />);
});

// edit form (inline)
admin.get("/_admin/links/:token/edit", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  const link = await getLink(c.env.LINKS, token);
  if (!link) return c.text("not found", 404);
  return c.html(<LinkRow link={link} shareDomain={c.env.SHARE_DOMAIN} mode="edit" />);
});

// update name/prefix/notes
admin.patch("/_admin/links/:token", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  const link = await getLink(c.env.LINKS, token);
  if (!link) return c.text("not found", 404);

  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const prefix = normalizePrefix(String(form.get("prefix") ?? ""));
  const notes = String(form.get("notes") ?? "").trim() || undefined;

  if (!name || !prefix) return c.text("invalid input", 400);

  const updated: ShareLink = { ...link, name, prefix, notes };
  await putLink(c.env.LINKS, updated);
  return c.html(<LinkRow link={updated} shareDomain={c.env.SHARE_DOMAIN} />);
});

// extend expiry — sets new absolute expiresAt = now + preset (un-revokes if revoked)
admin.post("/_admin/links/:token/extend", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  const link = await getLink(c.env.LINKS, token);
  if (!link) return c.text("not found", 404);

  const form = await c.req.formData();
  const presetId = String(form.get("preset") ?? "");
  const ms = presetMs(presetId);
  if (ms === null) return c.text("invalid preset", 400);

  const now = Date.now();
  const updated: ShareLink = {
    ...link,
    expiresAt: now + ms,
    revokedAt: undefined,
  };
  await putLink(c.env.LINKS, updated);
  return c.html(<LinkRow link={updated} shareDomain={c.env.SHARE_DOMAIN} />);
});

// revoke
admin.post("/_admin/links/:token/revoke", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  const link = await getLink(c.env.LINKS, token);
  if (!link) return c.text("not found", 404);
  const updated: ShareLink = { ...link, revokedAt: Date.now() };
  await putLink(c.env.LINKS, updated);
  return c.html(<LinkRow link={updated} shareDomain={c.env.SHARE_DOMAIN} />);
});

// hard delete — return empty so HTMX outerHTML swap removes the row
admin.delete("/_admin/links/:token", async (c) => {
  const token = c.req.param("token");
  if (!isValidToken(token)) return c.text("not found", 404);
  await deleteLink(c.env.LINKS, token);
  return c.body("", 200);
});

// typeahead — bucket.list({ prefix, delimiter: '/' })
admin.get("/_admin/prefixes", async (c) => {
  const q = (c.req.query("prefix") ?? "").trim();
  if (!q) return c.html(<Suggestions folders={[]} files={[]} q="" />);

  // limit guards against accidentally huge listings; UI can paginate later
  const res = await c.env.BUCKET.list({
    prefix: q,
    delimiter: "/",
    limit: 50,
  });

  const folders = (res.delimitedPrefixes ?? []).slice(0, 12);
  const files = res.objects
    .map((o) => o.key)
    .filter((k) => k !== q) // hide exact-match echo
    .slice(0, 12);

  return c.html(<Suggestions folders={folders} files={files} q={q} />);
});

admin.all("*", (c) => c.text("not found", 404));

// ---------- helpers ----------

function normalizePrefix(input: string): string {
  return input.trim().replace(/^\/+/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default admin;
