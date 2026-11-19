"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { previewBulkRates, type BulkRateTarget, type NightlyRate } from "@/lib/reservations/nightly-rates";

type Props = {
  rates: NightlyRate[];
  disabled: boolean;
  onApply: (updates: NightlyRate[]) => void;
};

const fieldClass = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-neutral-300 bg-white px-2 text-base focus-visible:outline-2 focus-visible:outline-blue-700 sm:text-sm";
const buttonClass = "min-h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-50";

function yenFromInput(value: string) {
  const normalized = value.trim().normalize("NFKC");
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized) ? Number(normalized.replaceAll(",", "")) : NaN;
}

export function BulkNightlyRates({ rates, disabled, onApply }: Props) {
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"nightly" | "total">("nightly");
  const [scope, setScope] = useState<BulkRateTarget["kind"]>("unset");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [amount, setAmount] = useState("");
  const [breakfast, setBreakfast] = useState("");
  const [appliedNights, setAppliedNights] = useState(0);

  const target: BulkRateTarget = scope === "range" ? { kind: scope, start, end } : { kind: scope };
  const ready = amount.trim() && (scope !== "range" || (start && end));
  const preview = ready ? previewBulkRates(rates, {
    target,
    mode,
    amount: yenFromInput(amount),
    breakfast: breakfast.trim() ? yenFromInput(breakfast) : undefined,
  }) : null;
  const result = preview && "updates" in preview ? preview : null;

  function apply() {
    if (!result || disabled) return;
    onApply(result.updates);
    setAppliedNights(result.updates.length);
    setOpen(false);
    toggleRef.current?.focus();
  }

  function applyOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      apply();
    }
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button ref={toggleRef} type="button" className={buttonClass} aria-expanded={open} aria-controls={panelId} disabled={disabled || !rates.length} onClick={() => { setOpen(!open); setAppliedNights(0); }}>
          料金を一括設定
        </button>
        <p className="text-sm text-neutral-700" role="status">{appliedNights > 0 ? `${appliedNights}泊に反映しました。「保存」で確定します。` : ""}</p>
      </div>
      {open ? (
        <fieldset id={panelId} disabled={disabled} className="mt-3 min-w-0 space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <legend className="sr-only">料金の一括設定</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${panelId}-mode`} className="text-sm font-medium text-neutral-800">設定方法</label>
              <select id={`${panelId}-mode`} className={fieldClass} value={mode} onChange={(event) => { setMode(event.target.value === "total" ? "total" : "nightly"); setAmount(""); }}>
                <option value="nightly">1泊ごとの内訳を入力</option>
                <option value="total">契約総額から配分</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${panelId}-scope`} className="text-sm font-medium text-neutral-800">適用先</label>
              <select id={`${panelId}-scope`} className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value as BulkRateTarget["kind"])}>
                <option value="unset">未設定の泊だけ</option>
                <option value="all">全泊</option>
                <option value="range">期間を指定</option>
              </select>
            </div>
          </div>
          {scope === "range" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-neutral-800">開始日
                <input type="date" className={fieldClass} value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="text-sm font-medium text-neutral-800">終了日（この日も含む）
                <input type="date" className={fieldClass} value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-neutral-800">{mode === "total" ? "予約全体の契約総額（朝食込み・円）" : "1泊の宿泊代（朝食抜き・円）"}
              <input inputMode="numeric" className={fieldClass} value={amount} onChange={(event) => setAmount(event.target.value)} onKeyDown={applyOnEnter} />
            </label>
            <label className="text-sm font-medium text-neutral-800">1泊の朝食代（円・任意）
              <input inputMode="numeric" className={fieldClass} value={breakfast} placeholder="空欄なら今の内訳を維持" onChange={(event) => setBreakfast(event.target.value)} onKeyDown={applyOnEnter} />
            </label>
          </div>
          {mode === "total" ? <p className="text-sm text-neutral-700">契約総額から対象外の泊の料金を差し引き、残額を対象の泊に配分します。</p> : null}
          <div className="space-y-1 text-sm" aria-live="polite">
            {preview && "error" in preview ? <p className="text-red-800">{preview.error}</p> : null}
            {result ? (
              <>
                <p className="font-semibold tabular-nums text-neutral-900">{result.updates.length}泊に適用 · 適用後の合計 {result.total.toLocaleString("ja-JP")}円</p>
                {result.overwritten > 0 ? <p className="text-amber-900">設定済みの料金を{result.overwritten}泊分上書きします。</p> : null}
                {result.unset > 0 ? <p className="text-neutral-700">適用後も{result.unset}泊の料金が未設定です。</p> : null}
              </>
            ) : null}
          </div>
          <button type="button" className={buttonClass} disabled={!result} onClick={apply}>表に反映</button>
        </fieldset>
      ) : null}
    </div>
  );
}
