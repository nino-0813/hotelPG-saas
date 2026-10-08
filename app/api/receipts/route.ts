import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/gmail";
import { getReceiptIssuer } from "@/lib/receipt-config";
import type { ReceiptPdfData } from "@/lib/receipt-pdf";
import { createEncryptedReceiptToken } from "@/lib/receipt-token";
import { reservationRevenue, reservationTax } from "@/lib/revenue";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/route-handler";
import type { PaymentMethod, Reservation } from "@/lib/types/database";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReservationWithRoom = Reservation & {
  rooms: null | {
    room_number: string;
    properties: null | { name: string };
  };
};

async function requireAdmin() {
  const supabase = await createRouteHandlerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "ログインが必要です" }, { status: 401 }) };

  const { data: staff } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staff?.role !== "admin") {
    return { response: NextResponse.json({ error: "領収書を発行する権限がありません" }, { status: 403 }) };
  }
  return { supabase, user };
}

function receiptNumber() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replaceAll("/", "");
  return `HPG-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function paymentLabel(value: PaymentMethod) {
  if (value === "onsite") return "現地決済";
  if (value === "accounts_receivable") return "売掛";
  return "オンライン決済";
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const reservationId = req.nextUrl.searchParams.get("reservationId") ?? "";
  if (!UUID_RE.test(reservationId)) {
    return NextResponse.json({ error: "予約IDが正しくありません" }, { status: 400 });
  }
  const { data, error } = await auth.supabase
    .from("receipt_documents")
    .select("id, receipt_number, access_token, recipient_name, amount, issued_at, emailed_at, reissue_number")
    .eq("reservation_id", reservationId)
    .order("issued_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ receipts: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;
    const body = (await req.json()) as Record<string, unknown>;
    const reservationId = typeof body.reservationId === "string" ? body.reservationId : "";
    const recipientName = typeof body.recipientName === "string" ? body.recipientName.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const sendEmail = body.sendEmail === true;
    const amount = typeof body.amount === "number" ? Math.round(body.amount) : Number(body.amount);

    if (!UUID_RE.test(reservationId) || !recipientName || !description || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "宛名・但し書き・1円以上の金額を入力してください" }, { status: 400 });
    }
    if (sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "送信先メールアドレスを確認してください" }, { status: 400 });
    }

    const { data: reservationRaw, error: reservationError } = await auth.supabase
      .from("reservations")
      .select("*, rooms(room_number, properties(name))")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError || !reservationRaw) {
      return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
    }
    const reservation = reservationRaw as unknown as ReservationWithRoom;
    const { count } = await auth.supabase
      .from("receipt_documents")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", reservationId);
    const taxes = reservationTax(reservation);
    const nonTaxableAmount = Math.min(Math.max(taxes.lodging, 0), amount);
    const taxableAmount = Math.max(amount - nonTaxableAmount, 0);
    const taxAmount = Math.min(
      taxes.consumption > 0 ? taxes.consumption : Math.floor(taxableAmount * 10 / 110),
      taxableAmount,
    );
    const issuer = getReceiptIssuer();
    const issuedAt = new Date().toISOString();
    const number = receiptNumber();

    const snapshot: ReceiptPdfData = {
      receiptNumber: number,
      reissueNumber: count ?? 0,
      issuedAt,
      recipientName,
      description,
      amount,
      taxableAmount,
      taxAmount,
      nonTaxableAmount,
      paymentMethod: reservation.payment_method,
      propertyName: reservation.rooms?.properties?.name ?? null,
      roomNumber: reservation.rooms?.room_number ?? null,
      checkInDate: reservation.check_in_date,
      checkOutDate: reservation.check_out_date,
      issuerName: issuer.name,
      facilityName: issuer.facilityName,
      issuerAddress: issuer.address,
      facilityAddresses: issuer.facilityAddresses,
      issuerPhone: issuer.phone,
      invoiceRegistrationNumber: issuer.invoiceRegistrationNumber,
    };
    const { data: receipt, error: insertError } = await auth.supabase
      .from("receipt_documents")
      .insert({
        reservation_id: reservationId,
        receipt_number: number,
        reissue_number: count ?? 0,
        recipient_name: recipientName,
        description,
        amount,
        taxable_amount: taxableAmount,
        tax_amount: taxAmount,
        non_taxable_amount: nonTaxableAmount,
        payment_method: reservation.payment_method,
        guest_name: reservation.guest_name,
        guest_email: email || reservation.guest_email,
        property_name: reservation.rooms?.properties?.name ?? null,
        room_number: reservation.rooms?.room_number ?? null,
        check_in_date: reservation.check_in_date,
        check_out_date: reservation.check_out_date,
        issuer_name: issuer.name,
        issuer_address: issuer.address,
        issuer_phone: issuer.phone,
        invoice_registration_number: issuer.invoiceRegistrationNumber,
        issued_at: issuedAt,
        issued_by: auth.user.id,
      })
      .select("id, receipt_number, access_token, issued_at, reissue_number")
      .single();
    const stored = Boolean(receipt && !insertError);
    if (insertError && insertError.code !== "42P01" && insertError.code !== "PGRST205") {
      throw insertError;
    }
    const accessToken = stored
      ? receipt!.access_token
      : createEncryptedReceiptToken(snapshot);
    const downloadUrl = new URL(`/receipt/${accessToken}`, req.nextUrl.origin).toString();
    let emailedAt: string | null = null;
    let emailError: string | null = null;
    if (sendEmail) {
      const stay = `${reservation.check_in_date.replaceAll("-", "/")} - ${reservation.check_out_date.replaceAll("-", "/")}`;
      try {
        await sendMail(
          email,
          "【HOTEL PG】領収書発行のご案内",
          `${recipientName} 様\n\nHOTEL PGをご利用いただき、ありがとうございます。\n領収書を発行しました。下記の専用URLからPDFをダウンロードしてください。\n\n領収書番号: ${number}\n宿泊期間: ${stay}\n金額: ${amount.toLocaleString("ja-JP")}円\n支払方法: ${paymentLabel(reservation.payment_method)}\n\n領収書ダウンロードURL\n${downloadUrl}\n\n※このURLは領収書の閲覧専用です。第三者への転送はお控えください。\n\nHOTEL PG`,
        );
        emailedAt = new Date().toISOString();
        if (stored) {
          const { error: updateError } = await auth.supabase
            .from("receipt_documents")
            .update({ emailed_at: emailedAt })
            .eq("id", receipt!.id);
          if (updateError) {
            console.error("[receipts] emailed_at update failed", updateError);
          }
        }
      } catch (mailError) {
        console.error("[receipts] email delivery failed", mailError);
        emailError = "領収書は発行されましたが、メール送信に失敗しました。送信先を確認し、専用URLをお客様へ送付してください。";
      }
    }

    return NextResponse.json({
      success: true,
      receipt: {
        receipt_number: number,
        issued_at: issuedAt,
        reissue_number: count ?? 0,
        downloadUrl,
        emailed_at: emailedAt,
        email_error: emailError,
        stored,
      },
      suggestedAmount: reservationRevenue(reservation),
    });
  } catch (error) {
    console.error("[receipts]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "領収書の発行に失敗しました" },
      { status: 500 },
    );
  }
}
