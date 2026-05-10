import { format } from "date-fns";

export type SyncBookingPreview = {
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
};

export function formatBookingPreviewLine(b: SyncBookingPreview): string {
  const ci = format(new Date(`${b.check_in_date}T12:00:00`), "M/d");
  const co = format(new Date(`${b.check_out_date}T12:00:00`), "M/d");
  return `${b.guest_name}（${ci}〜${co}）`;
}

export type SyncTotalsRow = {
  ok: boolean;
  created: number;
  updated: number;
  cancelled: number;
  newBookings: SyncBookingPreview[];
};

/** 複数カレンダー（全部同期）の要約 */
export function summarizeMultipleSyncResults(results: SyncTotalsRow[]): {
  headline: string;
  detailLines: string[];
} {
  const total = results.length;
  const ok = results.filter((r) => r.ok).length;
  const failed = total - ok;
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const detailLines: string[] = [];
  const MAX_LINES = 25;

  for (const r of results) {
    if (!r.ok) continue;
    created += r.created;
    updated += r.updated;
    cancelled += r.cancelled;
    for (const b of r.newBookings) {
      if (detailLines.length >= MAX_LINES) break;
      detailLines.push(formatBookingPreviewLine(b));
    }
  }

  const headlineParts = [
    `${ok}/${total} カレンダー成功${failed > 0 ? `（${failed}件はエラー）` : ""}`,
    `新規 ${created}件`,
    `更新 ${updated}件`,
    cancelled > 0 ? `キャンセル反映 ${cancelled}件` : null,
  ].filter(Boolean);

  return {
    headline: headlineParts.join(" · "),
    detailLines,
  };
}

/** 1カレンダー同期の要約 */
export function summarizeSingleSyncResult(r: SyncTotalsRow): {
  headline: string;
  detailLines: string[];
} {
  if (!r.ok) return { headline: "", detailLines: [] };
  const headlineParts = [
    `新規 ${r.created}件`,
    `更新 ${r.updated}件`,
    r.cancelled > 0 ? `キャンセル反映 ${r.cancelled}件` : null,
  ].filter(Boolean);
  return {
    headline: headlineParts.join(" · "),
    detailLines: r.newBookings.map(formatBookingPreviewLine),
  };
}
