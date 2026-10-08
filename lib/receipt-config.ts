export function getReceiptIssuer() {
  return {
    name: process.env.RECEIPT_ISSUER_NAME?.trim() || "合同会社ルノア",
    facilityName: process.env.RECEIPT_FACILITY_NAME?.trim() || "HOTELPG",
    address:
      process.env.RECEIPT_ISSUER_ADDRESS?.trim() ||
      "〒720-0807 広島県福山市明治町13番5号",
    facilityAddresses: [
      process.env.RECEIPT_PG1_ADDRESS?.trim() ||
        "PG I：〒722-2323 広島県尾道市因島土生町1896-17",
      process.env.RECEIPT_PG2_ADDRESS?.trim() ||
        "PG II：〒722-2323 広島県尾道市因島土生町1896-8",
      process.env.RECEIPT_PG3_ADDRESS?.trim() ||
        "PG III：〒722-2323 広島県尾道市因島土生町1747-5",
    ],
    phone: process.env.RECEIPT_ISSUER_PHONE?.trim() || "070-8328-9154",
    invoiceRegistrationNumber:
      process.env.RECEIPT_INVOICE_REGISTRATION_NUMBER?.trim() ||
      "T8240003003828",
  };
}
