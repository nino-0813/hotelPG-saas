/**
 * OTA calendars publish inventory closures as VEVENTs alongside reservations.
 * These labels are not guests and must never be counted as stays or sales.
 */
const OTA_BLOCK_SUMMARY_PATTERNS: RegExp[] = [
  /not\s*available/i,
  /\bblocked?\b/i,
  /\bclosed?\b/i,
  /stop\s*sale/i,
  /unavailable/i,
  /予約不可/,
  /受付停止/,
  /販売停止/,
];

export function isOtaBlockSummary(summary: string | null | undefined): boolean {
  const value = summary?.trim() ?? "";
  if (!value) return false;
  return OTA_BLOCK_SUMMARY_PATTERNS.some((pattern) => pattern.test(value));
}
