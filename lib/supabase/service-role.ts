import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client with elevated privileges (bypasses RLS).
 * Use only in Route Handlers / server code; never expose the key to the browser.
 */
export function createServiceRoleSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? null;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    null;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL or key (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)",
    );
  }
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
