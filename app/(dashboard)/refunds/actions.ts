"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import {
  createStripeRefund,
  retrieveStripeCheckoutSessionForRefund,
} from "@/lib/stripe/stripe-api";

export type RefundPolicy =
  | "full"
  | "deduct_processing_fee"
  | "last_minute"
  | "custom";

async function requireAdmin() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) throw new Error("ログインが必要です");
  const { data: staff } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staff?.role !== "admin") throw new Error("管理者権限が必要です");
  return user;
}

export async function saveRefundSettings(formData: FormData) {
  const user = await requireAdmin();
  const normalPolicy = String(formData.get("normal_policy") ?? "full");
  const processingFeeRate = Number(formData.get("processing_fee_rate"));
  const lastMinuteDays = Number(formData.get("last_minute_days"));
  const lastMinuteFeeType = String(formData.get("last_minute_fee_type") ?? "percentage");
  const lastMinuteFeeValue = Number(formData.get("last_minute_fee_value"));

  if (!['full', 'deduct_processing_fee'].includes(normalPolicy)) throw new Error("通常時の返金設定が不正です");
  if (!Number.isFinite(processingFeeRate) || processingFeeRate < 0 || processingFeeRate > 100) throw new Error("決済手数料率は0〜100%で入力してください");
  if (!Number.isInteger(lastMinuteDays) || lastMinuteDays < 0 || lastMinuteDays > 365) throw new Error("直前キャンセルの日数が不正です");
  if (!['percentage', 'fixed'].includes(lastMinuteFeeType)) throw new Error("キャンセル料の種類が不正です");
  if (!Number.isInteger(lastMinuteFeeValue) || lastMinuteFeeValue < 0 || (lastMinuteFeeType === "percentage" && lastMinuteFeeValue > 100)) throw new Error("キャンセル料が不正です");

  const { error } = await createServiceRoleSupabase().from("refund_settings").upsert({
    id: true,
    normal_policy: normalPolicy,
    processing_fee_rate: processingFeeRate,
    last_minute_days: lastMinuteDays,
    last_minute_fee_type: lastMinuteFeeType,
    last_minute_fee_value: lastMinuteFeeValue,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/refunds");
}

export async function getRefundPreview(reservationId: string) {
  await requireAdmin();
  const db = createServiceRoleSupabase();
  const { data: reservation, error } = await db
    .from("reservations")
    .select("id,status,stripe_session_id,check_in_date")
    .eq("id", reservationId)
    .single();
  if (error || !reservation) throw new Error("予約が見つかりません");
  if (reservation.status !== "cancelled") throw new Error("キャンセル済みの予約だけ返金できます");
  if (!reservation.stripe_session_id) throw new Error("Stripe決済情報がありません");

  const session = await retrieveStripeCheckoutSessionForRefund(reservation.stripe_session_id);
  if (session.payment_status !== "paid" || !session.payment_intent || !session.amount_total) {
    throw new Error("返金できるStripe決済を確認できませんでした");
  }
  const metadataFee = Number(session.metadata?.onlinePaymentFeeAmount ?? "");
  return {
    originalAmount: session.amount_total,
    paymentIntentId: session.payment_intent,
    currency: session.currency ?? "jpy",
    processingFeeAmount: Number.isInteger(metadataFee) && metadataFee >= 0 ? metadataFee : null,
    checkInDate: reservation.check_in_date,
  };
}

export async function executeStripeRefund(input: {
  reservationId: string;
  amountJpy: number;
  policy: RefundPolicy;
}) {
  const user = await requireAdmin();
  const preview = await getRefundPreview(input.reservationId);
  if (!Number.isInteger(input.amountJpy) || input.amountJpy <= 0 || input.amountJpy > preview.originalAmount) {
    throw new Error("返金額が不正です");
  }
  if (!['full', 'deduct_processing_fee', 'last_minute', 'custom'].includes(input.policy)) {
    throw new Error("返金方法が不正です");
  }

  const db = createServiceRoleSupabase();
  const { data: reservation } = await db
    .from("reservations")
    .select("stripe_session_id")
    .eq("id", input.reservationId)
    .single();
  if (!reservation?.stripe_session_id) throw new Error("Stripe決済情報がありません");

  const { data: existing } = await db
    .from("refund_transactions")
    .select("id,status,refund_amount")
    .eq("reservation_id", input.reservationId)
    .maybeSingle();
  if (existing?.status === "succeeded") throw new Error("この予約は返金済みです");
  if (existing && existing.refund_amount !== input.amountJpy) {
    throw new Error("処理履歴があるため返金額を変更できません。管理者へ確認してください");
  }

  let transactionId = existing?.id as string | undefined;
  if (!transactionId) {
    const { data: created, error: insertError } = await db
      .from("refund_transactions")
      .insert({
        reservation_id: input.reservationId,
        stripe_session_id: reservation.stripe_session_id,
        stripe_payment_intent_id: preview.paymentIntentId,
        original_charge_amount: preview.originalAmount,
        refund_amount: input.amountJpy,
        deducted_amount: preview.originalAmount - input.amountJpy,
        policy: input.policy,
        status: "pending",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insertError || !created) throw new Error(insertError?.message ?? "返金履歴を作成できませんでした");
    transactionId = created.id;
  }
  if (!transactionId) throw new Error("返金履歴を確認できませんでした");
  const stableTransactionId = transactionId;

  try {
    const refund = await createStripeRefund({
      paymentIntentId: preview.paymentIntentId,
      amountJpy: input.amountJpy,
      idempotencyKey: `hotelpg-refund-${stableTransactionId}`,
      metadata: { reservation_id: input.reservationId, refund_transaction_id: stableTransactionId },
    });
    const supportedStatuses = [
      "pending",
      "succeeded",
      "failed",
      "canceled",
      "requires_action",
    ] as const;
    const status = supportedStatuses.find((value) => value === refund.status) ?? "pending";
    await db.from("refund_transactions").update({
      stripe_refund_id: refund.id,
      status,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", stableTransactionId);
    revalidatePath("/refunds");
    return { ok: true, status, stripeRefundId: refund.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe返金に失敗しました";
    await db.from("refund_transactions").update({
      status: "failed",
      error_message: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", stableTransactionId);
    revalidatePath("/refunds");
    throw new Error(message);
  }
}
