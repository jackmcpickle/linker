/** ISO timestamp for `<time datetime="">` attribute. */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** Server-side coarse "in 5 days" / "3 hours ago" — refined client-side via TZ-aware JS later. */
export function relative(ms: number, now: number = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const past = diff < 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  let value: number;
  let unit: string;
  if (abs < minute) {
    return past ? "just now" : "in a moment";
  }
  if (abs < hour) {
    value = Math.round(abs / minute);
    unit = value === 1 ? "minute" : "minutes";
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unit = value === 1 ? "hour" : "hours";
  } else if (abs < week) {
    value = Math.round(abs / day);
    unit = value === 1 ? "day" : "days";
  } else {
    value = Math.round(abs / week);
    unit = value === 1 ? "week" : "weeks";
  }
  return past ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}

/** Compact absolute "12 Mar 2026 14:30 UTC". */
export function absolute(ms: number): string {
  return new Date(ms).toUTCString();
}
