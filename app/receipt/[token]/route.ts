import { NextRequest } from "next/server";
import { buildReceiptPdf } from "@/lib/receipt-pdf";
import { readEncryptedReceiptToken } from "@/lib/receipt-token";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("領収書が見つかりません", { status: 404 });
  }
  let receiptData = readEncryptedReceiptToken(token);
  if (!receiptData && UUID_RE.test(token)) {
    const supabase = createServiceRoleSupabase();
    const { data } = await supabase
      .from("receipt_documents")
      .select("*")
      .eq("access_token", token)
      .maybeSingle();
    if (data) {
      receiptData = {
        receiptNumber: data.receipt_number,
        reissueNumber: data.reissue_number,
        issuedAt: data.issued_at,
        recipientName: data.recipient_name,
        description: data.description,
        amount: data.amount,
        taxableAmount: data.taxable_amount,
        taxAmount: data.tax_amount,
        nonTaxableAmount: data.non_taxable_amount,
        paymentMethod: data.payment_method,
        propertyName: data.property_name,
        roomNumber: data.room_number,
        checkInDate: data.check_in_date,
        checkOutDate: data.check_out_date,
        issuerName: data.issuer_name,
        issuerAddress: data.issuer_address,
        issuerPhone: data.issuer_phone,
        invoiceRegistrationNumber: data.invoice_registration_number,
      };
    }
  }
  if (!receiptData) return new Response("領収書が見つかりません", { status: 404 });
  const pdf = await buildReceiptPdf(receiptData);
  const safeNumber = receiptData.receiptNumber.replace(/[^A-Za-z0-9-]/g, "");
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${safeNumber}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}
