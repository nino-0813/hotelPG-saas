"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import clsx from "clsx";
import type {
  PaymentMethod,
  Property,
  Reservation,
  ReservationStatus,
  Room,
} from "@/lib/types/database";
import {
  changeReservationStatus,
  createReservation,
  deleteReservation,
  updateReservation,
} from "./actions";
import { cancelReservation } from "@/app/actions/cancelReservation";

export type ModalState =
  | { mode: "closed" }
  | { mode: "new"; roomId: string; date: string }
  | { mode: "view"; reservation: Reservation };

type Props = {
  state: ModalState;
  onClose: () => void;
  properties: Property[];
  rooms: Room[];
};

export function ReservationModal({ state, onClose, properties, rooms }: Props) {
  useEffect(() => {
    if (state.mode === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [state.mode, onClose]);

  if (state.mode === "closed") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/40 sm:items-center sm:justify-center sm:px-4 sm:py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="h-full w-full overflow-auto bg-white shadow-xl sm:h-auto sm:max-h-full sm:max-w-2xl sm:rounded-lg">
        {state.mode === "new" ? (
          <NewReservationForm
            roomId={state.roomId}
            date={state.date}
            rooms={rooms}
            properties={properties}
            onClose={onClose}
          />
        ) : (
          <ReservationDetail
            reservation={state.reservation}
            rooms={rooms}
            properties={properties}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// New reservation
// ============================================================

function NewReservationForm({
  roomId,
  date,
  rooms,
  properties,
  onClose,
}: {
  roomId: string;
  date: string;
  rooms: Room[];
  properties: Property[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === roomId);
  const property = properties.find((p) => p.id === room?.property_id);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      const result = await createReservation({
        room_id: roomId,
        guest_name: String(formData.get("guest_name")),
        guest_phone: String(formData.get("guest_phone") || ""),
        guest_count: Number(formData.get("guest_count")) || 1,
        check_in_date: String(formData.get("check_in_date")),
        check_in_time: String(formData.get("check_in_time") || "15:00"),
        check_out_date: String(formData.get("check_out_date")),
        check_out_time: String(formData.get("check_out_time") || "11:00"),
        payment_method: String(formData.get("payment_method")) as PaymentMethod,
        smart_key_code: String(formData.get("smart_key_code") || ""),
        special_notes: String(formData.get("special_notes") || ""),
        source: String(formData.get("source") || ""),
      });
      if (result.error) {
        setError(result.error);
      } else {
        onClose();
      }
    });
  };

  // Default check-out: next day
  const defaultCheckOut = (() => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return format(d, "yyyy-MM-dd");
  })();

  return (
    <form action={handleSubmit}>
      <ModalHeader
        title="新規予約"
        subtitle={
          property && room
            ? `${property.name} / ${room.room_number}`
            : "部屋情報なし"
        }
        onClose={onClose}
      />

      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <Field label="ゲスト名" required>
          <input
            name="guest_name"
            required
            autoFocus
            className={inputCls}
            placeholder="山田 太郎"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="電話番号">
            <input
              name="guest_phone"
              className={inputCls}
              placeholder="090-1234-5678"
            />
          </Field>
          <Field label="人数" required>
            <input
              name="guest_count"
              type="number"
              min={1}
              max={10}
              defaultValue={2}
              required
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="チェックイン日" required>
            <input
              name="check_in_date"
              type="date"
              defaultValue={date}
              required
              className={inputCls}
            />
          </Field>
          <Field label="時刻">
            <input
              name="check_in_time"
              type="time"
              defaultValue="15:00"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="チェックアウト日" required>
            <input
              name="check_out_date"
              type="date"
              defaultValue={defaultCheckOut}
              required
              className={inputCls}
            />
          </Field>
          <Field label="時刻">
            <input
              name="check_out_time"
              type="time"
              defaultValue="11:00"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="支払方法" required>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="payment_method"
                value="online"
                defaultChecked
                required
              />
              オンライン
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="payment_method" value="onsite" />
              現地決済
            </label>
          </div>
        </Field>

        <Field label="スマートキー番号">
          <input
            name="smart_key_code"
            className={inputCls}
            placeholder="1234"
          />
        </Field>

        <Field label="特記事項">
          <textarea
            name="special_notes"
            rows={2}
            className={inputCls}
            placeholder="バイク有 / アレルギー対応 など"
          />
        </Field>

        <Field label="予約元">
          <input
            name="source"
            className={inputCls}
            placeholder="manual / booking.com / airbnb"
            defaultValue="manual"
          />
        </Field>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <ModalFooter>
        <button type="button" onClick={onClose} className={btnSecondary}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "作成中..." : "予約を作成"}
        </button>
      </ModalFooter>
    </form>
  );
}

// ============================================================
// View / Edit reservation
// ============================================================

function ReservationDetail({
  reservation,
  rooms,
  properties,
  onClose,
}: {
  reservation: Reservation;
  rooms: Room[];
  properties: Property[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === reservation.room_id);
  const property = properties.find((p) => p.id === room?.property_id);

  const handleStatusChange = (status: ReservationStatus) => {
    startTransition(async () => {
      setError(null);
      const result = await changeReservationStatus(reservation.id, status);
      if (result.error) setError(result.error);
      else {
        router.refresh();
        if (status === "cancelled") onClose();
      }
    });
  };

  const handleCancel = () => {
    if (reservation.status === "cancelled") return;
    if (!confirm("この予約をキャンセルしますか？")) return;
    startTransition(async () => {
      setError(null);
      try {
        await cancelReservation(reservation.id);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const handleRestoreFromCancelled = () => {
    if (
      !confirm(
        "キャンセルを取り消し、予約を「確認済み」に戻します。カレンダーにも再表示されます。よろしいですか？",
      )
    )
      return;
    startTransition(async () => {
      setError(null);
      const result = await changeReservationStatus(
        reservation.id,
        "confirmed",
      );
      if (result.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("この予約を完全に削除します。よろしいですか？")) return;
    startTransition(async () => {
      setError(null);
      const result = await deleteReservation(reservation.id);
      if (result.error) setError(result.error);
      else {
        router.refresh();
        onClose();
      }
    });
  };

  if (editing) {
    return (
      <EditReservationForm
        reservation={reservation}
        property={property}
        room={room}
        onCancel={() => setEditing(false)}
        onSaved={onClose}
      />
    );
  }

  return (
    <div>
      <ModalHeader
        title="予約詳細"
        subtitle={
          property && room
            ? `${property.name} / ${room.room_number}`
            : "部屋情報なし"
        }
        onClose={onClose}
      />

      <div className="space-y-3 px-4 py-4 text-sm sm:px-6 sm:py-5">
        <StatusRow status={reservation.status} />

        {reservation.status === "cancelled" ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            カレンダーには表示されません。誤ってキャンセルした場合は「予約を復元」で確認済みに戻せます。
          </p>
        ) : null}

        <Row label="ゲスト">{reservation.guest_name}</Row>
        <Row label="電話">{reservation.guest_phone ?? "—"}</Row>
        <Row label="人数">{reservation.guest_count}名</Row>
        <Row label="チェックイン">
          {reservation.check_in_date} {reservation.check_in_time?.slice(0, 5)}
        </Row>
        <Row label="チェックアウト">
          {reservation.check_out_date} {reservation.check_out_time?.slice(0, 5)}
        </Row>
        <Row label="支払方法">
          {reservation.payment_method === "onsite" ? (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-800">
              現地決済
            </span>
          ) : (
            "オンライン"
          )}
        </Row>
        <Row label="スマートキー">{reservation.smart_key_code ?? "—"}</Row>
        <Row label="特記事項">
          {reservation.special_notes ? (
            <span className="whitespace-pre-wrap">
              {reservation.special_notes}
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row label="予約元">{reservation.source ?? "—"}</Row>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <ModalFooter>
        <div className="flex flex-wrap gap-2 sm:flex-1">
          {reservation.status === "confirmed" && (
            <button
              type="button"
              onClick={() => handleStatusChange("checked_in")}
              disabled={pending}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              チェックイン
            </button>
          )}
          {reservation.status === "checked_in" && (
            <button
              type="button"
              onClick={() => handleStatusChange("checked_out")}
              disabled={pending}
              className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              チェックアウト
            </button>
          )}
          {reservation.status !== "cancelled" && (
            <button
              type="button"
              onClick={() => {
                handleCancel();
              }}
              disabled={pending}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              予約をキャンセル
            </button>
          )}
          {reservation.status === "cancelled" && (
            <>
              <button
                type="button"
                onClick={handleRestoreFromCancelled}
                disabled={pending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                予約を復元
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                完全に削除
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={btnSecondary}
        >
          編集
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>
          閉じる
        </button>
      </ModalFooter>
    </div>
  );
}

function EditReservationForm({
  reservation,
  property,
  room,
  onCancel,
  onSaved,
}: {
  reservation: Reservation;
  property: Property | undefined;
  room: Room | undefined;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      const result = await updateReservation({
        id: reservation.id,
        guest_name: String(formData.get("guest_name")),
        guest_phone: String(formData.get("guest_phone") || ""),
        guest_count: Number(formData.get("guest_count")) || 1,
        check_in_date: String(formData.get("check_in_date")),
        check_in_time: String(formData.get("check_in_time") || "15:00"),
        check_out_date: String(formData.get("check_out_date")),
        check_out_time: String(formData.get("check_out_time") || "11:00"),
        payment_method: String(formData.get("payment_method")) as PaymentMethod,
        smart_key_code: String(formData.get("smart_key_code") || ""),
        special_notes: String(formData.get("special_notes") || ""),
        source: String(formData.get("source") || ""),
      });
      if (result.error) setError(result.error);
      else onSaved();
    });
  };

  return (
    <form action={handleSubmit}>
      <ModalHeader
        title="予約を編集"
        subtitle={
          property && room
            ? `${property.name} / ${room.room_number}`
            : "部屋情報なし"
        }
        onClose={onCancel}
      />

      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <Field label="ゲスト名" required>
          <input
            name="guest_name"
            required
            defaultValue={reservation.guest_name}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="電話番号">
            <input
              name="guest_phone"
              defaultValue={reservation.guest_phone ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="人数" required>
            <input
              name="guest_count"
              type="number"
              min={1}
              max={10}
              defaultValue={reservation.guest_count}
              required
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="チェックイン日" required>
            <input
              name="check_in_date"
              type="date"
              defaultValue={reservation.check_in_date}
              required
              className={inputCls}
            />
          </Field>
          <Field label="時刻">
            <input
              name="check_in_time"
              type="time"
              defaultValue={reservation.check_in_time?.slice(0, 5)}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="チェックアウト日" required>
            <input
              name="check_out_date"
              type="date"
              defaultValue={reservation.check_out_date}
              required
              className={inputCls}
            />
          </Field>
          <Field label="時刻">
            <input
              name="check_out_time"
              type="time"
              defaultValue={reservation.check_out_time?.slice(0, 5)}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="支払方法" required>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="payment_method"
                value="online"
                defaultChecked={reservation.payment_method === "online"}
                required
              />
              オンライン
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="payment_method"
                value="onsite"
                defaultChecked={reservation.payment_method === "onsite"}
              />
              現地決済
            </label>
          </div>
        </Field>

        <Field label="スマートキー番号">
          <input
            name="smart_key_code"
            defaultValue={reservation.smart_key_code ?? ""}
            className={inputCls}
          />
        </Field>

        <Field label="特記事項">
          <textarea
            name="special_notes"
            rows={2}
            defaultValue={reservation.special_notes ?? ""}
            className={inputCls}
          />
        </Field>

        <Field label="予約元">
          <input
            name="source"
            defaultValue={reservation.source ?? ""}
            className={inputCls}
          />
        </Field>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <ModalFooter>
        <button type="button" onClick={onCancel} className={btnSecondary}>
          戻る
        </button>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "保存中..." : "保存"}
        </button>
      </ModalFooter>
    </form>
  );
}

// ============================================================
// Shared bits
// ============================================================

function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between border-b border-neutral-200 bg-white px-4 py-3.5 sm:px-6 sm:py-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-m-1 rounded-md p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        aria-label="閉じる"
      >
        ✕
      </button>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3 sm:px-6">
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-700">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3">
      <span className="text-xs text-neutral-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function StatusRow({ status }: { status: ReservationStatus }) {
  const map: Record<
    ReservationStatus,
    { label: string; cls: string }
  > = {
    confirmed: { label: "予約確定", cls: "bg-sky-100 text-sky-800" },
    checked_in: {
      label: "チェックイン済み",
      cls: "bg-emerald-100 text-emerald-800",
    },
    checked_out: {
      label: "チェックアウト済み",
      cls: "bg-neutral-100 text-neutral-700",
    },
    cancelled: { label: "キャンセル", cls: "bg-red-100 text-red-800" },
  };
  const { label, cls } = map[status];
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3">
      <span className="text-xs text-neutral-500">ステータス</span>
      <span
        className={clsx(
          "inline-block rounded-md px-2 py-0.5 text-xs font-medium",
          cls,
        )}
      >
        {label}
      </span>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none";
const btnPrimary =
  "rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50";
