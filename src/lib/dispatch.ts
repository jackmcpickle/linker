import { isValidToken } from './nanoid';

export type HostClass = { kind: 'admin' } | { kind: 'share'; token: string } | { kind: 'unknown' };

/**
 * Classify a request by Host header.
 *
 * - exact `adminHost` → admin
 * - `localhost` / `127.0.0.1` / `admin.localhost` → admin (dev only)
 * - `<token>.<shareDomain>` (single-label, valid 10-char nanoid) → share
 * - `<token>.localhost` (single-label, !== 'admin') → share (dev only, format unchecked)
 * - anything else → unknown (caller should throw to trigger CF Fail open)
 */
export function classifyHost(host: string, shareDomain: string, adminHost: string): HostClass {
    const h = host.split(':')[0]?.toLowerCase() ?? '';
    if (!h) return { kind: 'unknown' };

    const admin = adminHost.toLowerCase();
    if (h === admin || h === 'localhost' || h === '127.0.0.1' || h === 'admin.localhost') {
        return { kind: 'admin' };
    }

    const prodSuffix = '.' + shareDomain.toLowerCase();
    if (h.endsWith(prodSuffix)) {
        const label = h.slice(0, -prodSuffix.length);
        if (label && !label.includes('.') && isValidToken(label)) {
            return { kind: 'share', token: label };
        }
    }

    if (h.endsWith('.localhost')) {
        const label = h.slice(0, -'.localhost'.length);
        if (label && !label.includes('.') && label !== 'admin') {
            return { kind: 'share', token: label };
        }
    }

    return { kind: 'unknown' };
}
