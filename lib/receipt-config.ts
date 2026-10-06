export function getReceiptIssuer() {
  return {
    name: process.env.RECEIPT_ISSUER_NAME?.trim() || "合同会社ルノア",
    address:
      process.env.RECEIPT_ISSUER_ADDRESS?.trim() ||
      "〒720-0807 広島県福山市明治町13-5",
    phone: process.env.RECEIPT_ISSUER_PHONE?.trim() || "084-928-8855",
    invoiceRegistrationNumber:
      process.env.RECEIPT_INVOICE_REGISTRATION_NUMBER?.trim() || null,
  };
}

