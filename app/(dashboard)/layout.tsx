import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { DesktopNav, MobileBottomNav } from "./nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: staffRow } = await supabase
    .from("staff")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = staffRow?.display_name ?? user.email;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3 md:gap-6">
          <Link href="/" className="text-base font-semibold tracking-tight">
            HotelPG
          </Link>
          <DesktopNav isAdmin={staffRow?.role === "admin"} />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden max-w-[160px] truncate text-neutral-500 sm:inline">
            {displayName}
          </span>
          {staffRow?.role === "admin" ? (
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              admin
            </span>
          ) : null}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50"
              aria-label="サインアウト"
              title="サインアウト"
            >
              <span className="hidden sm:inline">サインアウト</span>
              <span className="sm:hidden">⏻</span>
            </button>
          </form>
        </div>
      </header>

      {/* Bottom padding (pb-20) on mobile reserves space for the bottom nav */}
      <div className="flex-1 pb-20 md:pb-0">{children}</div>

      <MobileBottomNav />
    </div>
  );
}
