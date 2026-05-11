import crypto from "node:crypto";

export function verifyStripeSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  webhookSecret: string | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  const { rawBody, signatureHeader, webhookSecret } = params;
  if (!webhookSecret) return { ok: false, error: "STRIPE_WEBHOOK_SECRET missing" };
  if (!signatureHeader) return { ok: false, error: "Missing stripe-signature" };

  const parts = signatureHeader.split(",").map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return { ok: false, error: "Invalid stripe-signature" };

  const timestamp = tPart.slice(2);
  const v1 = v1Part.slice(3);
  if (!timestamp || !v1) return { ok: false, error: "Invalid stripe-signature" };

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    if (a.length !== b.length) return { ok: false, error: "Signature mismatch" };
    const ok = crypto.timingSafeEqual(a, b);
    return ok ? { ok: true } : { ok: false, error: "Signature mismatch" };
  } catch {
    return { ok: false, error: "Signature verification failed" };
  }
}

