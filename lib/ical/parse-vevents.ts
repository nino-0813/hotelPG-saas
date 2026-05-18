/** Minimal RFC 5545 VEVENT parser (no node-ical — safe on Vercel + pnpm). */

export type RawVEvent = {
  uid: string;
  summary: string;
  description: string;
  dtstart: string;
  dtstartParams: Record<string, string>;
  dtend: string;
  dtendParams: Record<string, string>;
};

function unfoldLines(icsText: string): string[] {
  const raw = icsText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function parsePropertyLine(line: string): {
  name: string;
  value: string;
  params: Record<string, string>;
} {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return { name: line.toUpperCase(), value: "", params: {} };
  }
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = head.split(";");
  const name = (segments[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const eq = segments[i].indexOf("=");
    if (eq === -1) continue;
    const k = segments[i].slice(0, eq).toUpperCase();
    const v = segments[i].slice(eq + 1);
    params[k] = v;
  }
  return { name, value, params };
}

export function extractVevents(icsText: string): RawVEvent[] {
  const lines = unfoldLines(icsText);
  const events: RawVEvent[] = [];
  let inEvent = false;
  let bag: Partial<RawVEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      bag = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (bag?.uid) {
        events.push({
          uid: bag.uid,
          summary: bag.summary ?? "",
          description: bag.description ?? "",
          dtstart: bag.dtstart ?? "",
          dtstartParams: bag.dtstartParams ?? {},
          dtend: bag.dtend ?? "",
          dtendParams: bag.dtendParams ?? {},
        });
      }
      inEvent = false;
      bag = null;
      continue;
    }
    if (!inEvent || !bag) continue;

    const { name, value, params } = parsePropertyLine(line);
    switch (name) {
      case "UID":
        bag.uid = value;
        break;
      case "SUMMARY":
        if (bag.summary === undefined) bag.summary = value;
        break;
      case "DESCRIPTION":
        if (bag.description === undefined) bag.description = value;
        else bag.description += "\n" + value;
        break;
      case "DTSTART":
        if (bag.dtstart === undefined) {
          bag.dtstart = value;
          bag.dtstartParams = params;
        }
        break;
      case "DTEND":
        if (bag.dtend === undefined) {
          bag.dtend = value;
          bag.dtendParams = params;
        }
        break;
      default:
        break;
    }
  }

  return events;
}

/** YYYYMMDD or YYYYMMDDTHHMMSS(Z) → YYYY-MM-DD (UTC date part). */
export function icsValueToDateYmd(
  value: string,
  params: Record<string, string>,
): string | null {
  const v = value.trim();
  if (!v) return null;

  const isDateOnly =
    params.VALUE === "DATE" || (/^\d{8}$/.test(v) && !v.includes("T"));

  if (isDateOnly && /^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }

  const m = /^(\d{4})(\d{2})(\d{2})T/.exec(v);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }

  return null;
}
