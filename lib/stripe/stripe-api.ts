type StripeCheckoutSessionResponse = {
  id: string;
  url: string | null;
};

export type StripeCheckoutSessionForRefund = {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  payment_status: string | null;
  metadata: Record<string, string> | null;
};

export type StripeRefundResponse = {
  id: string;
  amount: number;
  currency: string;
  payment_intent: string | null;
  status: string | null;
};

function requireEnv(name: string, v: string | undefined | null): string {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function createStripeCheckoutSession(params: {
  amountJpy: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const secretKey = requireEnv("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
  if (!Number.isInteger(params.amountJpy) || params.amountJpy <= 0) {
    throw new Error("Invalid amountJpy");
  }

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("currency", "jpy");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  form.set("customer_email", params.customerEmail);

  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "jpy");
  form.set("line_items[0][price_data][unit_amount]", String(params.amountJpy));
  form.set(
    "line_items[0][price_data][product_data][name]",
    "HOTEL PG 公式サイト予約",
  );

  for (const [k, v] of Object.entries(params.metadata)) {
    if (v == null) continue;
    const value = String(v);
    // Keep metadata small (Stripe limits apply).
    form.set(`metadata[${k}]`, value.slice(0, 240));
  }

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const json = (await resp.json()) as unknown;
  if (!resp.ok) {
    const msg = (() => {
      if (typeof json === "object" && json) {
        const rec = json as Record<string, unknown>;
        if ("error" in rec) return JSON.stringify(rec.error);
      }
      return JSON.stringify(json);
    })();
    throw new Error(`Stripe error: ${resp.status} ${msg}`);
  }

  const s = json as StripeCheckoutSessionResponse;
  if (!s.id || !s.url) throw new Error("Stripe returned no session url");
  return { id: s.id, url: s.url };
}

async function stripeRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const secretKey = requireEnv("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json()) as unknown;
  if (!response.ok) {
    const error = json as { error?: { message?: string } };
    throw new Error(error.error?.message ?? `Stripe API error (${response.status})`);
  }
  return json as T;
}

export async function retrieveStripeCheckoutSessionForRefund(
  sessionId: string,
): Promise<StripeCheckoutSessionForRefund> {
  return stripeRequest<StripeCheckoutSessionForRefund>(
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function createStripeRefund(params: {
  paymentIntentId: string;
  amountJpy: number;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<StripeRefundResponse> {
  if (!Number.isInteger(params.amountJpy) || params.amountJpy <= 0) {
    throw new Error("返金額が不正です");
  }
  const form = new URLSearchParams();
  form.set("payment_intent", params.paymentIntentId);
  form.set("amount", String(params.amountJpy));
  form.set("reason", "requested_by_customer");
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    form.set(`metadata[${key}]`, value.slice(0, 240));
  }
  return stripeRequest<StripeRefundResponse>("/refunds", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: form.toString(),
  });
}
