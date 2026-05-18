import { extractVevents, icsValueToDateYmd } from "./parse-vevents";

export type ParsedReservation = {
  uid: string;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  reservation_code: string | null;
  check_in_date: string; // YYYY-MM-DD
  check_out_date: string; // YYYY-MM-DD
  guest_count: number;
  adults: number;
  children: number;
  infants: number;
  price: number | null;
  property_label: string | null;
  source_url: string | null;
};

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "HotelPG-saas/1.0" },
  });
  if (!res.ok) {
    throw new Error(`ics fetch failed: HTTP ${res.status}`);
  }
  return await res.text();
}

export function parseIcs(icsText: string): ParsedReservation[] {
  const events: ParsedReservation[] = [];

  for (const ev of extractVevents(icsText)) {
    const summary = ev.summary;
    const description = unfoldDescription(ev.description);
    const desc = parseDescription(description);
    const guestPhone = extractGuestPhone(desc, description);
    const guestEmail = normalizeEmail(desc.EMAIL) ?? extractEmailFromText(description);

    // SUMMARY: "Lauw Felicia(V036-YTTXVICE)"
    const sumMatch = /^(.+?)(?:\(([\w-]+)\))?$/.exec(summary.trim());
    const guestName = sumMatch?.[1]?.trim() ?? summary.trim();
    const reservationCode = sumMatch?.[2] ?? null;

    // Prefer DESCRIPTION's CHECKIN/CHECKOUT (unambiguous YYYY/MM/DD).
    // Fall back to DTSTART/DTEND only if missing.
    const checkInDate =
      normalizeDate(desc.CHECKIN) ??
      icsValueToDateYmd(ev.dtstart, ev.dtstartParams);
    const checkOutDate =
      normalizeDate(desc.CHECKOUT) ??
      icsValueToDateYmd(ev.dtend, ev.dtendParams);

    if (!checkInDate || !checkOutDate) continue;
    if (!ev.uid) continue;

    const guests = desc.GUESTS ?? "";
    const adults = pickInt(guests, /ADULTS:\s*(\d+)/);
    const children = pickInt(guests, /CHILDREN:\s*(\d+)/);
    const infants = pickInt(guests, /INFANTS:\s*(\d+)/);
    const totalMatch = /^\s*(\d+)/.exec(guests);
    const guest_count =
      (totalMatch ? parseInt(totalMatch[1], 10) : 0) ||
      adults + children + infants ||
      1;

    const price = desc.PRICE ? Number(desc.PRICE) : null;

    events.push({
      uid: ev.uid,
      guest_name: guestName,
      guest_phone: guestPhone,
      guest_email: guestEmail,
      reservation_code: reservationCode,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      guest_count,
      adults,
      children,
      infants,
      price: Number.isFinite(price as number) ? (price as number) : null,
      property_label: desc.PROPERTY ?? null,
      source_url: desc.URL ?? null,
    });
  }

  return events;
}

// DESCRIPTION values with embedded literal "\n" tokens need normalization.
function unfoldDescription(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",");
}

function parseDescription(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Some sources use full-width colon "："
    const colon = line.indexOf(":");
    const zColon = colon === -1 ? line.indexOf("：") : -1;
    const idx = colon !== -1 ? colon : zColon;
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in result)) result[key] = value;
  }
  return result;
}

function extractGuestPhone(
  desc: Record<string, string>,
  fullText: string,
): string | null {
  const candidates: Array<string | undefined> = [
    desc.TEL,
    desc.TELEPHONE,
    desc.PHONE,
    desc.PHONENUMBER,
    desc.GUESTPHONE,
    desc.GUEST_PHONE,
    desc.CONTACT,
    desc["電話"],
    desc["電話番号"],
    desc["TEL番号"],
  ];
  for (const c of candidates) {
    const p = normalizePhoneCandidate(c);
    if (p) return p;
  }

  // Look through parsed keys for anything phone-ish.
  for (const [k, v] of Object.entries(desc)) {
    if (!v) continue;
    if (!/(tel|phone|電話)/i.test(k)) continue;
    const p = normalizePhoneCandidate(v);
    if (p) return p;
  }

  // Fallback: find something phone-like in the DESCRIPTION body.
  // Example matches: "+81 90-1234-5678", "090-1234-5678", "03-1234-5678"
  const normalizedBody = normalizePhoneText(fullText);
  const m = /(\+?\d[\d\s\-()]{7,}\d)/.exec(normalizedBody);
  const fallback = normalizePhoneCandidate(m?.[1]);
  return fallback;
}

function normalizePhoneText(s: string): string {
  // Convert full-width digits and common punctuation to ASCII
  return (
    s
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
      // common dash variants → hyphen
      .replace(/[‐‑‒–—―ー−]/g, "-")
      // full-width parentheses
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")")
  );
}

function normalizeEmail(input: string | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const oneLine = raw.replace(/\s+/g, "");
  return oneLine.includes("@") ? oneLine : null;
}

function extractEmailFromText(text: string): string | null {
  const oneLine = String(text ?? "").replace(/\s+/g, "");
  const m = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(oneLine);
  return m?.[1] ?? null;
}

function normalizePhoneCandidate(input: string | undefined): string | null {
  const raw = normalizePhoneText((input ?? "").trim());
  if (!raw) return null;
  // Keep original-ish formatting for storage, but reject if it doesn't look usable.
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return raw;
}

function pickInt(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? parseInt(m[1], 10) : 0;
}

function normalizeDate(input: string | undefined): string | null {
  if (!input) return null;
  // Accepts "2026/05/04" or "2026-05-04"
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(input);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
