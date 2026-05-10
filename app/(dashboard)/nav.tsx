"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/rooms", label: "部屋", icon: "🏠" },
  { href: "/reservations", label: "予約", icon: "📅" },
] as const;

const ADMIN_NAV_ITEMS = [
  { href: "/external-calendars", label: "外部連携" },
] as const;

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
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.href === "/rooms");
  const gridCols =
    navItems.length <= 1 ? "grid-cols-1" : "grid-cols-3";
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
            <span className="text-lg leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
