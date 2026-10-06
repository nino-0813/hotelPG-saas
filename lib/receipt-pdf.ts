import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type ReceiptPdfData = {
  receiptNumber: string;
  reissueNumber: number;
  issuedAt: string;
  recipientName: string;
  description: string;
  amount: number;
  taxableAmount: number;
  taxAmount: number;
  nonTaxableAmount: number;
  paymentMethod: "online" | "onsite" | "accounts_receivable";
  propertyName: string | null;
  roomNumber: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  issuerName: string;
  issuerAddress: string;
  issuerPhone: string | null;
  invoiceRegistrationNumber: string | null;
};

const COLORS = {
  ink: rgb(0.12, 0.13, 0.15),
  muted: rgb(0.39, 0.42, 0.46),
  line: rgb(0.86, 0.87, 0.89),
  soft: rgb(0.965, 0.968, 0.972),
  brand: rgb(0.06, 0.32, 0.53),
};

function yen(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${year}/${month}/${day}`;
}

function issuedDateLabel(value: string) {
  return dateLabel(value.slice(0, 10));
}

function paymentLabel(value: ReceiptPdfData["paymentMethod"]) {
  if (value === "onsite") return "現地決済";
  if (value === "accounts_receivable") return "売掛";
  return "オンライン決済";
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size = 10,
  color = COLORS.ink,
) {
  page.drawText(text, { x, y, size, font, color });
}

function drawRight(
  page: PDFPage,
  font: PDFFont,
  text: string,
  right: number,
  y: number,
  size = 10,
  color = COLORS.ink,
) {
  drawText(page, font, text, right - font.widthOfTextAtSize(text, size), y, size, color);
}

export async function buildReceiptPdf(data: ReceiptPdfData) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fontBytes = await readFile(
    path.join(process.cwd(), "public/fonts/NotoSansJP-Variable.ttf"),
  );
  const font = await document.embedFont(fontBytes, { subset: false });
  const latinBold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const left = 54;
  const right = width - 54;

  page.drawRectangle({ x: 0, y: 0, width, height: page.getHeight(), color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 817, width, height: 25, color: COLORS.brand });

  drawText(page, font, "領 収 書", left, 758, 27);
  if (data.reissueNumber > 0) {
    drawRight(page, font, `再発行 ${data.reissueNumber}回目`, right, 766, 9, COLORS.muted);
  }
  drawRight(page, font, `領収書番号  ${data.receiptNumber}`, right, 744, 9, COLORS.muted);
  drawRight(page, font, `発行日  ${issuedDateLabel(data.issuedAt)}`, right, 728, 9, COLORS.muted);

  drawText(page, font, `${data.recipientName}  様`, left, 670, 18);
  page.drawLine({ start: { x: left, y: 659 }, end: { x: 360, y: 659 }, thickness: 0.8, color: COLORS.ink });
  drawText(page, font, "下記の金額を正に領収いたしました。", left, 632, 10, COLORS.muted);

  page.drawRectangle({ x: left, y: 540, width: right - left, height: 66, color: COLORS.soft });
  drawText(page, font, "領収金額", left + 18, 579, 10, COLORS.muted);
  const amountText = yen(data.amount);
  page.drawText(amountText, {
    x: right - 18 - latinBold.widthOfTextAtSize(amountText, 28),
    y: 561,
    size: 28,
    font: latinBold,
    color: COLORS.ink,
  });
  page.drawLine({ start: { x: left, y: 522 }, end: { x: right, y: 522 }, thickness: 1.4, color: COLORS.brand });

  const rows: Array<[string, string]> = [
    ["但し書き", data.description],
    ["宿泊期間", `${dateLabel(data.checkInDate)} - ${dateLabel(data.checkOutDate)}`],
    ["施設・客室", [data.propertyName, data.roomNumber].filter(Boolean).join(" / ") || "-"],
    ["支払方法", paymentLabel(data.paymentMethod)],
  ];
  let rowY = 488;
  for (const [label, value] of rows) {
    drawText(page, font, label, left, rowY, 9, COLORS.muted);
    drawText(page, font, value, left + 96, rowY, 10);
    page.drawLine({ start: { x: left, y: rowY - 12 }, end: { x: right, y: rowY - 12 }, thickness: 0.5, color: COLORS.line });
    rowY -= 39;
  }

  drawText(page, font, "金額内訳", left, 305, 11);
  page.drawRectangle({ x: left, y: 215, width: 270, height: 70, borderColor: COLORS.line, borderWidth: 0.7 });
  drawText(page, font, "課税対象額（税込）", left + 14, 262, 9, COLORS.muted);
  drawRight(page, font, yen(data.taxableAmount), left + 255, 262, 9);
  drawText(page, font, "うち消費税（10%）", left + 14, 239, 9, COLORS.muted);
  drawRight(page, font, yen(data.taxAmount), left + 255, 239, 9);
  if (data.nonTaxableAmount > 0) {
    drawText(page, font, "非課税額（宿泊税等）", left + 14, 218, 8, COLORS.muted);
    drawRight(page, font, yen(data.nonTaxableAmount), left + 255, 218, 8);
  }

  const issuerX = 355;
  drawText(page, font, data.issuerName, issuerX, 285, 12);
  drawText(page, font, data.issuerAddress, issuerX, 263, 8.5, COLORS.muted);
  if (data.issuerPhone) drawText(page, font, `TEL ${data.issuerPhone}`, issuerX, 246, 8.5, COLORS.muted);
  if (data.invoiceRegistrationNumber) {
    drawText(page, font, `適格請求書発行事業者登録番号 ${data.invoiceRegistrationNumber}`, issuerX, 229, 7.5, COLORS.muted);
  }

  page.drawLine({ start: { x: left, y: 164 }, end: { x: right, y: 164 }, thickness: 0.5, color: COLORS.line });
  drawText(page, font, "本書はHOTEL PGの管理画面から発行された電子領収書です。", left, 140, 8, COLORS.muted);
  drawText(page, font, "領収書番号により発行履歴を管理しています。", left, 124, 8, COLORS.muted);

  document.setTitle(`領収書 ${data.receiptNumber}`);
  document.setAuthor(data.issuerName);
  document.setSubject("宿泊料金領収書");
  document.setProducer("HOTEL PG Operations");
  return document.save();
}

