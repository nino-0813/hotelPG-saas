"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(redirectTo || "/");
}

export async function signup(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/");

  if (!displayName) return { error: "名前を入力してください" };
  if (!email) return { error: "メールアドレスを入力してください" };
  if (password.length < 6) return { error: "パスワードは6文字以上で設定してください" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
    },
  });

  if (error) return { error: error.message };

  // メール確認が ON のままだとセッションが返らない。
  // その場合は確認メール待ちなので、わかりやすいエラーで案内する。
  if (!data.session) {
    return {
      error:
        "確認メールが送信されました。受信メールのリンクからアカウントを有効化してください。" +
        "（Supabase ダッシュボードで Confirm email を OFF にすると、このステップを省略できます）",
    };
  }

  redirect(redirectTo || "/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
