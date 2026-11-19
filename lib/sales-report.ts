import type { SupabaseClient } from "@supabase/supabase-js";
import { isOtaBlockSummary } from "./ical/ota-block";
import { allocatedYen, dateOrdinal } from "./reservations/nightly-rates";
import { reservationNightlyRates, reservationTax } from "./revenue";
import type { Reservation } from "./types/database";

export type SalesReservation = Pick<Reservation,
  "id" | "room_id" | "requested_property_id" | "guest_name" | "check_in_date" | "check_out_date" | "status" | "source" | "payment_method" | "special_notes" | "nightly_rates"
>;

export async function loadSalesReservations(supabase: SupabaseClient, start: string, end: string) {
  const reservations: SalesReservation[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("reservations")
      .select("id,room_id,requested_property_id,guest_name,check_in_date,check_out_date,status,source,payment_method,special_notes,nightly_rates")
      .not("status", "in", "(cancelled,blocked)")
      .lte("check_in_date", end).gt("check_out_date", start)
      .order("id").range(offset, offset + pageSize - 1).returns<SalesReservation[]>();

    if (error) return { reservations: [], error };
    reservations.push(...data.filter((row) => !isOtaBlockSummary(row.guest_name)));
    if (data.length < pageSize) return { reservations, error: null };
  }
}

export function reportPropertyId(row: SalesReservation, roomById: ReadonlyMap<string, { property_id: string }>) {
  return (row.room_id ? roomById.get(row.room_id)?.property_id : null) ?? row.requested_property_id;
}

/** Both the dashboard and CSV use inclusive report dates and exclude the checkout day. */
export function salesInPeriod(row: SalesReservation, start: string, end: string) {
  const { rates, estimated } = reservationNightlyRates(row);
  const tax = reservationTax(row);
  const first = Math.max(0, dateOrdinal(start) - dateOrdinal(row.check_in_date));
  const last = Math.min(rates.length, dateOrdinal(end) - dateOrdinal(row.check_in_date) + 1);
  const totals = { amount: 0, lodgingTax: 0, consumptionTax: 0, missing: 0, estimated: estimated && first < last };

  for (let i = first; i < last; i++) {
    const rate = rates[i];
    totals.amount += rate.amount ?? 0;
    totals.missing += Number(rate.amount === null);
    totals.lodgingTax += allocatedYen(tax.lodging, rates.length, i);
    totals.consumptionTax += allocatedYen(tax.consumption, rates.length, i);
  }
  return totals;
}
