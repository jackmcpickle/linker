export const EXPIRY_PRESETS = [
    { id: '1h', label: '1 hour', ms: 3_600_000 },
    { id: '6h', label: '6 hours', ms: 21_600_000 },
    { id: '1d', label: '1 day', ms: 86_400_000 },
    { id: '3d', label: '3 days', ms: 259_200_000 },
    { id: '1w', label: '1 week', ms: 604_800_000 },
    { id: '1mo', label: '1 month', ms: 2_592_000_000 },
] as const;

export type PresetId = (typeof EXPIRY_PRESETS)[number]['id'];

export const DEFAULT_PRESET: PresetId = '1w';

export function presetMs(id: string): number | null {
    return EXPIRY_PRESETS.find((p) => p.id === id)?.ms ?? null;
}
