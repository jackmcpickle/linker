import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { buildSetCookie, clearCookie, readCookie, signJSON, verifyJSON } from '../lib/cookie';

export const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type SessionPayload = { iat: number; exp: number };

export function isHttps(c: Context): boolean {
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
    return proto === 'https';
}

export function clientIp(c: Context): string {
    return (
        c.req.header('cf-connecting-ip') ??
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        'unknown'
    );
}

async function makeSessionCookie(c: Context<Env>): Promise<string> {
    const now = Date.now();
    const payload: SessionPayload = { iat: now, exp: now + SESSION_TTL_MS };
    const value = await signJSON(payload, c.env.COOKIE_HMAC_SECRET);
    return buildSetCookie({
        name: SESSION_COOKIE,
        value,
        maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
        secure: isHttps(c),
    });
}

export async function setSessionCookie(c: Context<Env>): Promise<void> {
    c.header('Set-Cookie', await makeSessionCookie(c), { append: true });
}

export function clearSessionCookie(c: Context<Env>): void {
    c.header('Set-Cookie', clearCookie(SESSION_COOKIE, isHttps(c)), { append: true });
}

async function readSession(c: Context<Env>): Promise<SessionPayload | null> {
    const raw = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    if (!raw) return null;
    const payload = await verifyJSON<SessionPayload>(raw, c.env.COOKIE_HMAC_SECRET);
    if (!payload) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload;
}

/** Middleware: require a valid session cookie, refresh sliding TTL on each request. */
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const session = await readSession(c);
    if (!session) return c.redirect('/_admin', 303);
    await setSessionCookie(c); // sliding refresh
    await next();
};

/** Used on /_admin landing: if already authed, skip the login page. */
export async function isAuthed(c: Context<Env>): Promise<boolean> {
    return (await readSession(c)) !== null;
}
