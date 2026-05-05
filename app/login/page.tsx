import { AuthTabs } from "./auth-tabs";

type SearchParams = Promise<{ redirect?: string; signup?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { redirect, signup } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          HotelPG オペレーション
        </h1>
        <p className="mb-8 text-sm text-neutral-500">
          ログインまたはアカウント作成してください
        </p>
        <AuthTabs
          redirectTo={redirect ?? "/"}
          initialMode={signup ? "signup" : "login"}
        />
      </div>
    </main>
  );
}
