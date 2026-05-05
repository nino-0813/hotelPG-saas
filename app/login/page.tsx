import { LoginForm } from "./login-form";

type SearchParams = Promise<{ redirect?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { redirect } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          HotelPG オペレーション
        </h1>
        <p className="mb-8 text-sm text-neutral-500">サインインしてください</p>
        <LoginForm redirectTo={redirect ?? "/"} />
      </div>
    </main>
  );
}
