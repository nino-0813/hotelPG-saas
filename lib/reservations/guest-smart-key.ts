/** Derive a 4-digit smart key hint from phone (same idea as iCal import). */
export function deriveSmartKeyCodeFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const normalized = phone
    .replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/[‐‑‒–—―ー−]/g, "-");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function deriveSmartKeyCodeFallback(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 39 + seed.charCodeAt(i)) % 100000;
  }
  const n = (hash % 9000) + 1000;
  return String(n).padStart(4, "0");
}
