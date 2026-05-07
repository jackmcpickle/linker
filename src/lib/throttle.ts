type ThrottleState = { fails: number; lockedUntil?: number };

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const TTL_SECONDS = 15 * 60;

const key = (ip: string) => `login:${ip}`;

export type ThrottleCheck = { allowed: true } | { allowed: false; lockedUntil: number };

export async function checkLoginThrottle(
    kv: KVNamespace,
    ip: string,
    now: number,
): Promise<ThrottleCheck> {
    const raw = await kv.get(key(ip));
    if (!raw) return { allowed: true };
    let state: ThrottleState;
    try {
        state = JSON.parse(raw) as ThrottleState;
    } catch {
        return { allowed: true };
    }
    if (state.lockedUntil && state.lockedUntil > now) {
        return { allowed: false, lockedUntil: state.lockedUntil };
    }
    return { allowed: true };
}

export async function recordLoginFailure(
    kv: KVNamespace,
    ip: string,
    now: number,
): Promise<ThrottleCheck> {
    const raw = await kv.get(key(ip));
    let state: ThrottleState = { fails: 0 };
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as ThrottleState;
            // If a previous lockout has expired, reset.
            state = parsed.lockedUntil && parsed.lockedUntil <= now ? { fails: 0 } : parsed;
        } catch {
            /* ignore corrupt */
        }
    }
    state.fails += 1;
    if (state.fails >= MAX_FAILS) {
        state.lockedUntil = now + LOCKOUT_MS;
    }
    await kv.put(key(ip), JSON.stringify(state), { expirationTtl: TTL_SECONDS });
    return state.lockedUntil && state.lockedUntil > now
        ? { allowed: false, lockedUntil: state.lockedUntil }
        : { allowed: true };
}

export async function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void> {
    await kv.delete(key(ip));
}
