import type { SupabaseClient } from "@supabase/supabase-js";
import { getTokyoDayKind } from "@/lib/availability/public-rate-rules";
import type { PublicGuestPriceRuleRow } from "@/lib/types/public-catalog";

export async function fetchGuestPriceRulesForCatalog(
  supabase: SupabaseClient,
  params: { propertyCode: string; roomType: string },
): Promise<PublicGuestPriceRuleRow[]> {
  const { data, error } = await supabase
    .from("public_guest_price_rules")
    .select("*")
    .eq("property_code", params.propertyCode)
    .eq("room_type", params.roomType)
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .returns<PublicGuestPriceRuleRow[]>();

  if (error) {
    console.error("[guest-price-rules] fetch", error);
    return [];
  }
  return data ?? [];
}

/**
 * Among active rules where min_guests <= guestCount <= max_guests,
 * returns the row with the highest priority (tie: first in desc order from query).
 */
export function pickBestGuestPriceRule(
  rows: PublicGuestPriceRuleRow[],
  guestCount: number,
): PublicGuestPriceRuleRow | null {
  const g = Math.max(1, Math.floor(guestCount));
  const matches = rows.filter(
    (r) => r.is_active && r.min_guests <= g && g <= r.max_guests,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.priority - a.priority);
  return matches[0] ?? null;
}

export function listPriceFromGuestRuleRow(
  rule: PublicGuestPriceRuleRow,
  dateYmd: string,
): number {
  const kind = getTokyoDayKind(dateYmd);
  if (kind === "friday") return rule.friday_price;
  if (kind === "saturday") return rule.saturday_price;
  return rule.weekday_price;
}
