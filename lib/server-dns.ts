import dns from "node:dns";

// Prefer IPv4 first to avoid intermittent IPv6 connectivity issues with some providers.
// Safe no-op on older Node versions.
try {
  const setDefaultResultOrder = (dns as unknown as { setDefaultResultOrder?: (order: string) => void })
    .setDefaultResultOrder;
  if (typeof setDefaultResultOrder === "function") {
    setDefaultResultOrder("ipv4first");
  }
} catch {
  // ignore
}
