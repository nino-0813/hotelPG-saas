import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    },
  );
}

/** One Supabase server client per React server request (avoids duplicate cookie/client setup). */
export const createClient = cache(createSupabaseServerClient);

/**
 * One auth.getUser() per request when layout + page both need the user.
 * Middleware still runs its own getUser first — this removes duplicate Auth calls in RSC trees.
 */
export const getCachedSupabaseAuth = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
});
