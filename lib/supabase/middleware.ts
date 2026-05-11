import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths that staff (role !== admin) may not open; they only use 部屋ステータス (/rooms). */
function staffPathForbidden(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/reservations")) return true;
  if (pathname.startsWith("/tasks")) return true;
  if (pathname.startsWith("/external-calendars")) return true;
  return false;
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Public ICS export (token-gated in the route handler). Must be reachable by external services.
  if (pathname.startsWith("/api/ical")) {
    return NextResponse.next({ request });
  }

  // Public read-only availability for the marketing site (no PII in response).
  if (pathname.startsWith("/api/public")) {
    return NextResponse.next({ request });
  }

  // Admin HTTP API (x-admin-api-secret in route handler; no Supabase session required).
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    // Google OAuth 完了後はログインセッションが無くても code と exchange できるようにする
    pathname.startsWith("/api/google/callback");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Session refresh only for asset/chunk requests — no staff routing.
  if (pathname.startsWith("/_next")) {
    return response;
  }

  let isAdmin = false;
  if (user) {
    const { data: staffRow } = await supabase
      .from("staff")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = staffRow?.role === "admin";
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = isAdmin ? "/reservations" : "/rooms";
    return NextResponse.redirect(url);
  }

  if (user && !isPublic && !isAdmin && staffPathForbidden(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/rooms";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
