import Link from "next/link";
import clsx from "clsx";

export function ReservationViewTabs({ active }: { active: "calendar" | "list" | "new" }) {
  const items = [
    { key: "calendar" as const, href: "/reservations", label: "カレンダー" },
    { key: "list" as const, href: "/reservations/list", label: "予約一覧" },
    { key: "new" as const, href: "/reservations/new", label: "＋ 新規予約追加" },
  ];

  return (
    <nav aria-label="予約表示の切り替え" className="mb-5 flex w-fit rounded-lg bg-neutral-100 p-1">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={clsx(
            "flex min-h-10 items-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
            active === item.key
              ? "bg-white text-neutral-950 shadow-sm"
              : "text-neutral-600 hover:text-neutral-950",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
