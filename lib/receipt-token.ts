import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ReceiptPdfData } from "@/lib/receipt-pdf";

function key() {
  const secret =
    process.env.RECEIPT_DOWNLOAD_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("領収書ダウンロード用の秘密鍵が設定されていません");
  return createHash("sha256").update(secret).digest();
}

export function createEncryptedReceiptToken(data: ReceiptPdfData) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, data }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function readEncryptedReceiptToken(token: string): ReceiptPdfData | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as { v?: number; data?: ReceiptPdfData };
    return parsed.v === 1 && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

