// 100 years in ms — sentinel for "never expires". Stays well under
// MAX_SAFE_INTEGER even after adding `Date.now()`, so all `<=` checks work.
export const NEVER_EXPIRES_MS = 100 * 365.25 * 24 * 60 * 60 * 1000;

// If `expiresAt - now` exceeds this, treat the link as non-expiring in the UI.
export const NEVER_EXPIRES_THRESHOLD_MS = 50 * 365.25 * 24 * 60 * 60 * 1000;

export const EXPIRY_PRESETS = [
    { id: '1h', label: '1 hour', ms: 3_600_000 },
    { id: '6h', label: '6 hours', ms: 21_600_000 },
    { id: '1d', label: '1 day', ms: 86_400_000 },
    { id: '3d', label: '3 days', ms: 259_200_000 },
    { id: '1w', label: '1 week', ms: 604_800_000 },
    { id: '1mo', label: '1 month', ms: 2_592_000_000 },
    { id: 'never', label: 'Never', ms: NEVER_EXPIRES_MS },
] as const;

export type PresetId = (typeof EXPIRY_PRESETS)[number]['id'];

export const DEFAULT_PRESET: PresetId = '1w';

export function presetMs(id: string): number | null {
    return EXPIRY_PRESETS.find(p => p.id === id)?.ms ?? null;
}

export function isNeverExpires(expiresAt: number, now = Date.now()): boolean {
    return expiresAt - now > NEVER_EXPIRES_THRESHOLD_MS;
}
