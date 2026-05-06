export type HostClass =
  | { kind: "admin" }
  | { kind: "share"; token: string }
  | { kind: "unknown" };

/**
 * Classify a request by Host header.
 *
 * - apex of share domain → admin
 * - localhost (any port) → admin (dev only)
 * - <token>.<shareDomain> → share
 * - <token>.localhost → share (dev only)
 * - anything else → unknown
 */
export function classifyHost(host: string, shareDomain: string): HostClass {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (!h) return { kind: "unknown" };

  if (h === shareDomain.toLowerCase() || h === "localhost" || h === "127.0.0.1") {
    return { kind: "admin" };
  }

  const prodSuffix = "." + shareDomain.toLowerCase();
  if (h.endsWith(prodSuffix)) {
    const token = h.slice(0, -prodSuffix.length);
    if (token && !token.includes(".")) return { kind: "share", token };
  }

  if (h.endsWith(".localhost")) {
    const token = h.slice(0, -".localhost".length);
    if (token && !token.includes(".")) return { kind: "share", token };
  }

  return { kind: "unknown" };
}
