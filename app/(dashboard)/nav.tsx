"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/rooms", label: "部屋", icon: "rooms" },
  { href: "/reservations", label: "予約", icon: "calendar" },
] as const;

const ADMIN_NAV_ITEMS = [
  { href: "/reports", label: "売上・稼働率", icon: "chart" },
  { href: "/pricing", label: "料金管理", icon: "pricing" },
  { href: "/rakuten-inventory", label: "楽天在庫" },
  { href: "/external-calendars", label: "外部連携" },
] as const;

function NavIcon({ name }: { name: string }) {
  if (name === "calendar") {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg>;
  }
  if (name === "chart") {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 20V10m7 10V4m7 16v-7M3 20h18" /></svg>;
  }
  if (name === "pricing") {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v18m4-14.5c-.8-1-2-1.5-4-1.5-2.2 0-4 1.1-4 3s1.5 2.7 4 3.2 4 1.4 4 3.5-1.8 3.3-4 3.3c-2 0-3.4-.6-4.4-1.8" /></svg>;
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11 12 4l9 7v9H3v-9Z" /><path d="M9 20v-6h6v6" /></svg>;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const navItems = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.href === "/rooms");
  return (
    <nav className="hidden items-center gap-1 text-sm md:flex">
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-md px-3 py-1.5 transition",
              active
                ? "bg-neutral-100 font-medium text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {isAdmin &&
        ADMIN_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-md px-3 py-1.5 transition",
                active
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900",
              )}
            >
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}

export function MobileBottomNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const navItems = isAdmin
    ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS.slice(0, 2)]
    : NAV_ITEMS.filter((item) => item.href === "/rooms");
  const gridCols =
    navItems.length <= 1 ? "grid-cols-1" : "grid-cols-4";
  return (
    <nav
      className={clsx(
        "fixed inset-x-0 bottom-0 z-30 grid border-t border-neutral-200 bg-white shadow-[0_-1px_2px_rgba(0,0,0,0.04)] md:hidden",
        gridCols,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition",
              active
                ? "font-semibold text-neutral-900"
                : "text-neutral-500 active:bg-neutral-100",
            )}
          >
            <NavIcon name={"icon" in item ? item.icon : ""} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
