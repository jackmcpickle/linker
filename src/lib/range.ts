/**
 * Parse a single byte-range header like "bytes=0-499" / "bytes=500-" / "bytes=-500".
 * Returns an R2-compatible range object, or null if unparseable / multi-range.
 */
export function parseRange(header: string):
  | { offset: number; length?: number }
  | { suffix: number }
  | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];

  if (!startStr && endStr) {
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { suffix: n };
  }
  if (startStr && !endStr) {
    const n = Number(startStr);
    if (!Number.isFinite(n) || n < 0) return null;
    return { offset: n };
  }
  if (startStr && endStr) {
    const a = Number(startStr);
    const b = Number(endStr);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) return null;
    return { offset: a, length: b - a + 1 };
  }
  return null;
}
