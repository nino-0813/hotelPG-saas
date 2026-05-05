"use client";

import { useState } from "react";
import clsx from "clsx";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

type Mode = "login" | "signup";

export function AuthTabs({
  redirectTo,
  initialMode = "login",
}: {
  redirectTo: string;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div>
      <div
        role="tablist"
        className="mb-6 grid grid-cols-2 rounded-md border border-neutral-200 bg-neutral-100 p-1 text-sm"
      >
        <Tab
          active={mode === "login"}
          onClick={() => setMode("login")}
          label="ログイン"
        />
        <Tab
          active={mode === "signup"}
          onClick={() => setMode("signup")}
          label="新規登録"
        />
      </div>

      {mode === "login" ? (
        <LoginForm redirectTo={redirectTo} />
      ) : (
        <SignupForm redirectTo={redirectTo} />
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "rounded px-3 py-1.5 transition",
        active
          ? "bg-white font-medium text-neutral-900 shadow-sm"
          : "text-neutral-600 hover:text-neutral-900",
      )}
    >
      {label}
    </button>
  );
}
