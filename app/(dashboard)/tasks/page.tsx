import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { redirect } from "next/navigation";
import {
  createClient,
  getCachedSupabaseAuth,
} from "@/lib/supabase/server";
import type {
  PaymentMethod,
  Property,
  ReservationStatus,
  Room,
  RoomType,
  Task,
} from "@/lib/types/database";
import { TaskList } from "./task-list";

type TaskWithJoins = Task & {
  room: Pick<Room, "room_number" | "room_type"> & {
    property: Pick<Property, "name" | "code">;
  };
  reservation: {
    guest_name: string;
    check_in_date: string;
    check_out_date: string;
    payment_method: PaymentMethod;
    special_notes: string | null;
    status: ReservationStatus;
  } | null;
};

type SearchParams = Promise<{
  range?: "today" | "tomorrow" | "week" | "all";
  status?: "active" | "all" | "done";
  mine?: "1";
}>;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = params.range ?? "today";
  const statusFilter = params.status ?? "active";
  const mineOnly = params.mine === "1";

  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");

  const { data: staffRow } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staffRow?.role !== "admin") redirect("/rooms");

  const now = new Date();
  const today = startOfDay(now);
  const { from, to, label } = computeRange(range, today);

  let query = supabase
    .from("tasks")
    .select(
      `
        *,
        room:rooms!inner(room_number, room_type, property:properties!inner(name, code)),
        reservation:reservations(guest_name, check_in_date, check_out_date, payment_method, special_notes, status)
      `,
    )
    .gte("scheduled_for", from.toISOString())
    .lte("scheduled_for", to.toISOString())
    .order("scheduled_for", { ascending: true });

  if (statusFilter === "active") {
    query = query.in("status", ["todo", "in_progress"]);
  } else if (statusFilter === "done") {
    query = query.eq("status", "done");
  }

  if (mineOnly && user) {
    query = query.eq("assignee_id", user.id);
  }

  const { data: tasks } = await query.returns<TaskWithJoins[]>();

  // Counts for filter badges
  const counts = await fetchCounts(supabase, today);

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">タスク</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{label}</p>
        </div>
        <Filters
          range={range}
          statusFilter={statusFilter}
          mineOnly={mineOnly}
          counts={counts}
        />
      </div>

      <TaskList tasks={tasks ?? []} currentUserId={user?.id ?? null} />
    </main>
  );
}

function computeRange(
  range: "today" | "tomorrow" | "week" | "all",
  today: Date,
): { from: Date; to: Date; label: string } {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 6);

  if (range === "tomorrow") {
    return {
      from: startOfDay(tomorrow),
      to: endOfDay(tomorrow),
      label: `${format(tomorrow, "yyyy/MM/dd (EEE)", { locale: ja })} のタスク`,
    };
  }
  if (range === "week") {
    return {
      from: startOfDay(today),
      to: endOfDay(weekEnd),
      label: `今日から1週間のタスク (${format(today, "M/d")} 〜 ${format(weekEnd, "M/d")})`,
    };
  }
  if (range === "all") {
    return {
      from: addDays(today, -7),
      to: addDays(today, 60),
      label: "過去1週間 〜 今後60日のタスク",
    };
  }
  // today (default) — 今日 + 期限超過
  return {
    from: addDays(today, -7),
    to: endOfDay(today),
    label: `${format(today, "yyyy/MM/dd (EEE)", { locale: ja })} までのタスク (期限超過含む)`,
  };
}

async function fetchCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: Date,
) {
  const todayEnd = endOfDay(today);
  const tomorrow = addDays(today, 1);
  const tomorrowEnd = endOfDay(tomorrow);
  const weekEnd = endOfDay(addDays(today, 6));

  const [todayActive, tomorrowActive, weekActive] = await Promise.all([
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", ["todo", "in_progress"])
      .lte("scheduled_for", todayEnd.toISOString()),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", ["todo", "in_progress"])
      .gte("scheduled_for", startOfDay(tomorrow).toISOString())
      .lte("scheduled_for", tomorrowEnd.toISOString()),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", ["todo", "in_progress"])
      .lte("scheduled_for", weekEnd.toISOString()),
  ]);

  return {
    today: todayActive.count ?? 0,
    tomorrow: tomorrowActive.count ?? 0,
    week: weekActive.count ?? 0,
  };
}

function Filters({
  range,
  statusFilter,
  mineOnly,
  counts,
}: {
  range: string;
  statusFilter: string;
  mineOnly: boolean;
  counts: { today: number; tomorrow: number; week: number };
}) {
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const next = { range, status: statusFilter, mine: mineOnly ? "1" : "", ...overrides };
    Object.entries(next).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return `?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Group label="期間">
        <Pill href={buildHref({ range: "today" })} active={range === "today"} count={counts.today}>
          今日
        </Pill>
        <Pill href={buildHref({ range: "tomorrow" })} active={range === "tomorrow"} count={counts.tomorrow}>
          明日
        </Pill>
        <Pill href={buildHref({ range: "week" })} active={range === "week"} count={counts.week}>
          1週間
        </Pill>
        <Pill href={buildHref({ range: "all" })} active={range === "all"}>
          全件
        </Pill>
      </Group>

      <Group label="状態">
        <Pill href={buildHref({ status: "active" })} active={statusFilter === "active"}>
          未完了
        </Pill>
        <Pill href={buildHref({ status: "done" })} active={statusFilter === "done"}>
          完了
        </Pill>
        <Pill href={buildHref({ status: "all" })} active={statusFilter === "all"}>
          すべて
        </Pill>
      </Group>

      <Pill
        href={buildHref({ mine: mineOnly ? undefined : "1" })}
        active={mineOnly}
      >
        自分の担当
      </Pill>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1">
      <span className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded px-2 py-1 text-xs transition ${
        active
          ? "bg-neutral-900 text-white"
          : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={`ml-1 rounded px-1 text-[10px] ${
            active ? "bg-white/20" : "bg-neutral-200 text-neutral-700"
          }`}
        >
          {count}
        </span>
      ) : null}
    </a>
  );
}

// Re-export types so client component can pick them up
export type { TaskWithJoins };
