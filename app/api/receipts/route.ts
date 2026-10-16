import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/gmail";
import { getReceiptIssuer } from "@/lib/receipt-config";
import type { ReceiptPdfData } from "@/lib/receipt-pdf";
import { createEncryptedReceiptToken } from "@/lib/receipt-token";
import { reservationRevenue, reservationTax } from "@/lib/revenue";
import { ACCOMMODATION_TAX_PER_GUEST_PER_NIGHT_JPY } from "@/lib/stripe/stripe-web-checkout-pricing";
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

function accommodationTaxForReservation(
  reservation: Pick<Reservation, "check_in_date" | "check_out_date" | "guest_count">,
  guestCount = reservation.guest_count,
) {
  const [inYear, inMonth, inDay] = reservation.check_in_date.split("-").map(Number);
  const [outYear, outMonth, outDay] = reservation.check_out_date.split("-").map(Number);
  const nights = Math.max(
    1,
    Math.round(
      (Date.UTC(outYear, outMonth - 1, outDay) -
        Date.UTC(inYear, inMonth - 1, inDay)) /
        86_400_000,
    ),
  );
  return (
    ACCOMMODATION_TAX_PER_GUEST_PER_NIGHT_JPY *
    Math.max(1, guestCount) *
    nights
  );
}

type SplitReceiptInput = {
  recipientName: string;
  email: string;
  amount: number;
};

function parseSplitReceipts(value: unknown): SplitReceiptInput[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const parsed = value.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const recipientName = typeof row.recipientName === "string" ? row.recipientName.trim() : "";
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const amount = typeof row.amount === "number" ? Math.round(row.amount) : Number(row.amount);
    if (!recipientName || !Number.isInteger(amount) || amount <= 0) return null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { recipientName, email, amount };
  });
  return parsed.every((entry): entry is SplitReceiptInput => entry !== null) ? parsed : null;
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
    const splitReceipts = parseSplitReceipts(body.receipts);

    if (!UUID_RE.test(reservationId)) {
      return NextResponse.json({ error: "予約IDが正しくありません" }, { status: 400 });
    }
    if (!splitReceipts && (!recipientName || !description || !Number.isInteger(amount) || amount <= 0)) {
      return NextResponse.json({ error: "宛名・但し書き・1円以上の金額を入力してください" }, { status: 400 });
    }
    if (!splitReceipts && sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    if (splitReceipts) {
      if (reservation.guest_count !== 2) {
        return NextResponse.json(
          { error: "2名予約の場合のみ、1名ずつの分割領収書を発行できます" },
          { status: 400 },
        );
      }
      const totalAmount = reservationRevenue(reservation);
      const splitTotal = splitReceipts.reduce((sum, entry) => sum + entry.amount, 0);
      if (totalAmount <= 0 || splitTotal !== totalAmount) {
        return NextResponse.json(
          { error: `2枚の合計金額を予約総額 ${totalAmount.toLocaleString("ja-JP")}円に合わせてください` },
          { status: 400 },
        );
      }
      if (sendEmail && splitReceipts.some((entry) => !entry.email)) {
        return NextResponse.json(
          { error: "メール送信する場合は、2名分の送信先を入力してください" },
          { status: 400 },
        );
      }

      const { count: issuedCount, error: issuedCountError } = await auth.supabase
        .from("receipt_documents")
        .select("id", { count: "exact", head: true })
        .eq("reservation_id", reservationId)
        .eq("reissue_number", 0);
      if (issuedCountError) throw issuedCountError;
      if ((issuedCount ?? 0) > 0) {
        return NextResponse.json(
          { error: "この予約には発行済みの領収書があります。重複発行を避けるため、発行履歴を確認してください" },
          { status: 409 },
        );
      }

      const issuer = getReceiptIssuer();
      const issuedAt = new Date().toISOString();
      const accommodationTaxPerGuest = accommodationTaxForReservation(reservation, 1);
      const snapshots = splitReceipts.map((entry) => {
        const nonTaxableAmount = Math.min(accommodationTaxPerGuest, entry.amount);
        const taxableAmount = Math.max(entry.amount - nonTaxableAmount, 0);
        const taxAmount = Math.floor((taxableAmount * 10) / 110);
        return {
          input: entry,
          snapshot: {
            receiptNumber: receiptNumber(),
            reissueNumber: 0,
            issuedAt,
            recipientName: entry.recipientName,
            description: description || "宿泊代として",
            amount: entry.amount,
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
          } satisfies ReceiptPdfData,
        };
      });

      const rows = snapshots.map(({ input, snapshot }) => ({
        reservation_id: reservationId,
        receipt_number: snapshot.receiptNumber,
        reissue_number: 0,
        recipient_name: input.recipientName,
        description: snapshot.description,
        amount: input.amount,
        taxable_amount: snapshot.taxableAmount,
        tax_amount: snapshot.taxAmount,
        non_taxable_amount: snapshot.nonTaxableAmount,
        payment_method: reservation.payment_method,
        guest_name: reservation.guest_name,
        guest_email: input.email || reservation.guest_email,
        property_name: snapshot.propertyName,
        room_number: snapshot.roomNumber,
        check_in_date: reservation.check_in_date,
        check_out_date: reservation.check_out_date,
        issuer_name: issuer.name,
        issuer_address: issuer.address,
        issuer_phone: issuer.phone,
        invoice_registration_number: issuer.invoiceRegistrationNumber,
        issued_at: issuedAt,
        issued_by: auth.user.id,
      }));
      const { data: storedReceipts, error: insertError } = await auth.supabase
        .from("receipt_documents")
        .insert(rows)
        .select("id, receipt_number, access_token");
      if (insertError || !storedReceipts || storedReceipts.length !== 2) {
        throw insertError ?? new Error("分割領収書を保存できませんでした");
      }

      const stay = `${reservation.check_in_date.replaceAll("-", "/")} - ${reservation.check_out_date.replaceAll("-", "/")}`;
      const results = [];
      for (const { input, snapshot } of snapshots) {
        const stored = storedReceipts.find(
          (receipt) => receipt.receipt_number === snapshot.receiptNumber,
        );
        if (!stored) throw new Error("発行した領収書を確認できませんでした");
        const downloadUrl = new URL(`/receipt/${stored.access_token}`, req.nextUrl.origin).toString();
        let emailedAt: string | null = null;
        let emailError: string | null = null;
        if (sendEmail) {
          try {
            await sendMail(
              input.email,
              "【HOTEL PG】領収書発行のご案内",
              `${input.recipientName} 様\n\nHOTEL PGをご利用いただき、ありがとうございます。\n1名様分の領収書を発行しました。下記の専用URLからPDFをダウンロードしてください。\n\n領収書番号: ${snapshot.receiptNumber}\n宿泊期間: ${stay}\n金額: ${input.amount.toLocaleString("ja-JP")}円\n支払方法: ${paymentLabel(reservation.payment_method)}\n\n領収書ダウンロードURL\n${downloadUrl}\n\n※このURLは領収書の閲覧専用です。第三者への転送はお控えください。\n\nHOTEL PG`,
            );
            emailedAt = new Date().toISOString();
            await auth.supabase
              .from("receipt_documents")
              .update({ emailed_at: emailedAt })
              .eq("id", stored.id);
          } catch (mailError) {
            console.error("[split receipts] email delivery failed", mailError);
            emailError = "領収書は発行されましたが、メール送信に失敗しました。";
          }
        }
        results.push({
          receipt_number: snapshot.receiptNumber,
          downloadUrl,
          emailed_at: emailedAt,
          email_error: emailError,
          stored: true,
          recipient_name: input.recipientName,
          amount: input.amount,
        });
      }
      return NextResponse.json({ success: true, receipts: results });
    }

    const { count } = await auth.supabase
      .from("receipt_documents")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", reservationId);
    const taxes = reservationTax(reservation);
    const calculatedAccommodationTax = accommodationTaxForReservation(reservation);
    const nonTaxableAmount = Math.min(calculatedAccommodationTax, amount);
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
