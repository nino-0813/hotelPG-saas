"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import clsx from "clsx";
import type {
  ExternalCalendar,
  Property,
  RoomType,
} from "@/lib/types/database";
import {
  addCalendar,
  deleteCalendar,
  syncAll,
  syncCalendar,
  toggleCalendarEnabled,
} from "./actions";

type Props = {
  properties: Property[];
  calendars: ExternalCalendar[];
};

const SOURCE_LABEL: Record<string, string> = {
  rakuten_oyado: "楽天お宿",
  booking_com: "Booking.com",
  airbnb: "Airbnb",
};

const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  family: "ファミリー",
  single: "シングル",
  standard: "スタンダード",
};

export function CalendarList({ properties, calendars }: Props) {
  const [showForm, setShowForm] = useState(calendars.length === 0);
  const [pending, startTransition] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const onSyncAll = () => {
    setSyncMessage(null);
    startTransition(async () => {
      const results = await syncAll();
      const total = results.length;
      const ok = results.filter((r) => r.ok).length;
      const totalImported = results.reduce((s, r) => s + r.imported, 0);
      const totalCancelled = results.reduce((s, r) => s + r.cancelled, 0);
      setSyncMessage(
        `${ok}/${total} 件成功 / 取り込み ${totalImported}件 / キャンセル ${totalCancelled}件`,
      );
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          {showForm ? "フォームを閉じる" : "+ ics URL を追加"}
        </button>
        {calendars.length > 0 && (
          <button
            type="button"
            onClick={onSyncAll}
            disabled={pending}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "同期中..." : "🔄 全部同期"}
          </button>
        )}
        {syncMessage && (
          <span className="text-xs text-neutral-600">{syncMessage}</span>
        )}
      </div>

      {showForm && (
        <AddForm
          properties={properties}
          onClose={() => setShowForm(false)}
        />
      )}

      {calendars.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-white px-6 py-12 text-center text-sm text-neutral-500">
          まだ ics URL が登録されていません。
          <br />
          上の「+ ics URL を追加」から登録してください。
        </div>
      ) : (
        <div className="space-y-2">
          {calendars.map((cal) => (
            <CalendarRow
              key={cal.id}
              calendar={cal}
              property={properties.find((p) => p.id === cal.property_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddForm({
  properties,
  onClose,
}: {
  properties: Property[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      const result = await addCalendar({
        source: String(formData.get("source") ?? "rakuten_oyado"),
        external_id: String(formData.get("external_id") ?? "").trim(),
        ics_url: String(formData.get("ics_url") ?? "").trim(),
        property_id: String(formData.get("property_id") ?? ""),
        target_room_type: String(formData.get("target_room_type") ?? "standard") as RoomType,
        display_name: String(formData.get("display_name") ?? ""),
      });
      if (result.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <form
      action={handleSubmit}
      className="space-y-3 rounded-md border border-neutral-200 bg-white p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="OTA" required>
          <select
            name="source"
            required
            className={inputCls}
            defaultValue="rakuten_oyado"
          >
            <option value="rakuten_oyado">楽天お宿</option>
            <option value="booking_com">Booking.com</option>
            <option value="airbnb">Airbnb</option>
            <option value="other">その他</option>
          </select>
        </Field>

        <Field label="物件" required>
          <select name="property_id" required className={inputCls} defaultValue="">
            <option value="" disabled>
              選択してください
            </option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="部屋タイプ" required>
        <select
          name="target_room_type"
          required
          className={inputCls}
          defaultValue="standard"
        >
          <option value="standard">スタンダード</option>
          <option value="family">ファミリー</option>
          <option value="single">シングル</option>
        </select>
      </Field>

      <Field
        label="ics URL"
        required
        hint="楽天お宿: 「カレンダーエクスポート」をクリック → 表示されたURLをコピー"
      >
        <input
          name="ics_url"
          type="url"
          required
          placeholder="https://ical.vacation-stay.jp/ical/v1/room_groups/XXXXXX.ics?s=..."
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="管理用ID" hint="例: 楽天 room_groups の番号 (917598)">
          <input
            name="external_id"
            placeholder="917598"
            required
            className={inputCls}
          />
        </Field>

        <Field label="表示名" hint="管理画面で識別しやすい名前">
          <input
            name="display_name"
            placeholder="HOTEL PG -II- ファミリー"
            className={inputCls}
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "追加中..." : "追加"}
        </button>
      </div>
    </form>
  );
}

function CalendarRow({
  calendar,
  property,
}: {
  calendar: ExternalCalendar;
  property: Property | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const onSync = () => {
    setResult(null);
    startTransition(async () => {
      const r = await syncCalendar(calendar.id);
      setResult(
        r.ok
          ? `✓ 取り込み ${r.imported}件 / キャンセル ${r.cancelled}件`
          : `✗ ${r.error ?? "エラー"}`,
      );
    });
  };

  const onToggle = () => {
    startTransition(async () => {
      await toggleCalendarEnabled(calendar.id, !calendar.enabled);
    });
  };

  const onDelete = () => {
    if (!confirm("この連携を削除しますか？(取り込み済みの予約は残ります)")) return;
    startTransition(async () => {
      await deleteCalendar(calendar.id);
    });
  };

  return (
    <div
      className={clsx(
        "rounded-md border bg-white p-3 transition",
        calendar.enabled ? "border-neutral-200" : "border-neutral-200 opacity-60",
        pending && "opacity-50",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {calendar.display_name ??
                `${property?.name ?? "?"} / ${ROOM_TYPE_LABEL[calendar.target_room_type as RoomType] ?? calendar.target_room_type}`}
            </span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
              {SOURCE_LABEL[calendar.source] ?? calendar.source}
            </span>
            {!calendar.enabled && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                無効
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[11px] text-neutral-500">
            {calendar.ics_url}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-neutral-500">
            <span>{property?.name ?? "?"}</span>
            <span>
              {ROOM_TYPE_LABEL[calendar.target_room_type as RoomType] ??
                calendar.target_room_type}
            </span>
            <span>
              最終同期:{" "}
              {calendar.last_synced_at
                ? format(new Date(calendar.last_synced_at), "M/d HH:mm")
                : "未"}
            </span>
            {calendar.last_sync_status === "success" && (
              <span className="text-emerald-700">
                ✓ 取込 {calendar.last_sync_imported}件
                {calendar.last_sync_cancelled > 0 && ` / キャンセル ${calendar.last_sync_cancelled}件`}
              </span>
            )}
            {calendar.last_sync_status === "error" && (
              <span className="text-red-700">
                ✗ {calendar.last_sync_error?.slice(0, 80) ?? "エラー"}
              </span>
            )}
          </div>
          {result && <div className="mt-1 text-[11px]">{result}</div>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onSync}
            disabled={pending || !calendar.enabled}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            🔄 同期
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50"
          >
            {calendar.enabled ? "無効化" : "有効化"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-0.5 block text-[11px] text-neutral-500">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none";
