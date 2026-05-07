import type { Context } from 'hono';
import {
    buildSetCookie,
    clearCookie,
    readCookie,
    signJSON,
    verifyJSON,
} from '../lib/cookie';
import type { ShareLink } from '../types';

export const SHARE_COOKIE = 'share_validated';
const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h ceiling

type SharePayload = { token: string; iat: number; exp: number };

function isHttps(c: Context): boolean {
    const proto =
        c.req.header('x-forwarded-proto') ??
        new URL(c.req.url).protocol.replace(':', '');
    return proto === 'https';
}

/** Build a Set-Cookie value for a freshly-validated share. Host-only (no Domain attr). */
export async function buildShareCookie(
    c: Context,
    link: ShareLink,
    secret: string,
): Promise<string | null> {
    const now = Date.now();
    const ttl = Math.min(MAX_TTL_MS, link.expiresAt - now);
    if (ttl <= 0) return null;
    const payload: SharePayload = {
        token: link.token,
        iat: now,
        exp: now + ttl,
    };
    const value = await signJSON(payload, secret);
    return buildSetCookie({
        name: SHARE_COOKIE,
        value,
        maxAgeSeconds: Math.floor(ttl / 1000),
        secure: isHttps(c),
    });
}

export function buildShareClear(c: Context): string {
    return clearCookie(SHARE_COOKIE, isHttps(c));
}

export async function hasValidShareCookie(
    c: Context,
    expectedToken: string,
    secret: string,
): Promise<boolean> {
    const raw = readCookie(c.req.header('cookie'), SHARE_COOKIE);
    if (!raw) return false;
    const payload = await verifyJSON<SharePayload>(raw, secret);
    if (!payload) return false;
    if (payload.token !== expectedToken) return false;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now())
        return false;
    return true;
}
