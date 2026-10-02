import type { PaymentMethod } from "@/lib/types/database";

export function paymentMethodLabel(method: PaymentMethod | string | null | undefined, short = false) {
  if (method === "onsite") return short ? "現地" : "現地決済";
  if (method === "accounts_receivable") return "売掛";
  return short ? "オンライン" : "オンライン決済";
}
