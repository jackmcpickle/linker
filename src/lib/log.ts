type LogEvent = Record<string, unknown> & { event: string };

/**
 * Structured single-line JSON logging — visible in CF Workers Logs.
 * Use for events worth searching ("event"). Avoid PII (no IPs in payload).
 */
export function log(event: LogEvent): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: Date.now(), ...event }));
}
