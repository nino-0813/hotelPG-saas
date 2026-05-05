"use client";

import { useState, useTransition } from "react";
import { signup } from "./actions";

export function SignupForm({ redirectTo }: { redirectTo: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const result = await signup(formData);
          if (result?.error) setError(result.error);
        })
      }
      className="space-y-4"
    >
      <input type="hidden" name="redirect" value={redirectTo} />

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="display_name">
          名前
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          autoComplete="name"
          placeholder="山田 太郎"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="signup-email">
          メールアドレス
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="signup-password">
          パスワード
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="6文字以上"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "作成中..." : "アカウント作成"}
      </button>
    </form>
  );
}
