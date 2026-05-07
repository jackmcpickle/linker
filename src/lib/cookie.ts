const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncodeBytes(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(s: string): string {
    return b64urlEncodeBytes(enc.encode(s));
}

function b64urlDecode(s: string): string | null {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    try {
        const bin = atob(padded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return dec.decode(bytes);
    } catch {
        return null;
    }
}

async function hmac(secret: string, data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return b64urlEncodeBytes(new Uint8Array(sig));
}

function constantTimeEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}

/** Sign an arbitrary string payload with HMAC-SHA256 → `<b64url-payload>.<b64url-sig>`. */
export async function sign(payload: string, secret: string): Promise<string> {
    const p = b64urlEncode(payload);
    const s = await hmac(secret, p);
    return `${p}.${s}`;
}

/** Verify and decode a signed value. Returns the original payload or null. */
export async function verify(signed: string, secret: string): Promise<string | null> {
    const dot = signed.indexOf('.');
    if (dot <= 0) return null;
    const p = signed.slice(0, dot);
    const s = signed.slice(dot + 1);
    const expected = await hmac(secret, p);
    if (!constantTimeEq(s, expected)) return null;
    return b64urlDecode(p);
}

/** Sign a JSON-serializable payload; verifyJSON returns the parsed object or null. */
export async function signJSON<T>(value: T, secret: string): Promise<string> {
    return sign(JSON.stringify(value), secret);
}

export async function verifyJSON<T>(signed: string, secret: string): Promise<T | null> {
    const raw = await verify(signed, secret);
    if (raw === null) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export type CookieOptions = {
    name: string;
    value: string;
    maxAgeSeconds: number;
    secure: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    domain?: string;
    path?: string;
    httpOnly?: boolean;
};

export function buildSetCookie(opts: CookieOptions): string {
    const parts = [`${opts.name}=${opts.value}`];
    parts.push(`Max-Age=${opts.maxAgeSeconds}`);
    parts.push(`Path=${opts.path ?? '/'}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`);
    if (opts.secure) parts.push('Secure');
    if (opts.domain) parts.push(`Domain=${opts.domain}`);
    return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
    return buildSetCookie({
        name,
        value: '',
        maxAgeSeconds: 0,
        secure,
    });
}

export function readCookie(header: string | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(/;\s*/)) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq) === name) return part.slice(eq + 1);
    }
    return null;
}
