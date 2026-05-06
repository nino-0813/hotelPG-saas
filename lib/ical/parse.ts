import * as ical from "node-ical";

export type ParsedReservation = {
  uid: string;
  guest_name: string;
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
  const data = ical.sync.parseICS(icsText);
  const events: ParsedReservation[] = [];

  for (const key in data) {
    const item = data[key];
    if (!item || item.type !== "VEVENT") continue;
    const ev = item as ical.VEvent;

    const summary = String(ev.summary ?? "");
    const description = unfoldDescription(String(ev.description ?? ""));
    const desc = parseDescription(description);

    // SUMMARY: "Lauw Felicia(V036-YTTXVICE)"
    const sumMatch = /^(.+?)(?:\(([\w-]+)\))?$/.exec(summary.trim());
    const guestName = sumMatch?.[1]?.trim() ?? summary.trim();
    const reservationCode = sumMatch?.[2] ?? null;

    // Prefer DESCRIPTION's CHECKIN/CHECKOUT (unambiguous YYYY/MM/DD).
    // Fall back to DTSTART/DTEND only if missing.
    const checkInDate =
      normalizeDate(desc.CHECKIN) ?? formatUtcDate(ev.start);
    const checkOutDate =
      normalizeDate(desc.CHECKOUT) ?? formatUtcDate(ev.end);

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
      uid: String(ev.uid),
      guest_name: guestName,
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

// Some iCal generators wrap long DESCRIPTION lines with leading-space
// continuations. node-ical mostly handles unfolding, but DESCRIPTION values
// with embedded literal "\n" tokens still need normalization.
function unfoldDescription(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",");
}

function parseDescription(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key && !(key in result)) result[key] = value;
  }
  return result;
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

function formatUtcDate(input: Date | undefined): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
