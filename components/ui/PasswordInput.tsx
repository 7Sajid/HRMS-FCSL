"use client";

import { useState, type ComponentProps } from "react";
import { INPUT_CLASS } from "./Field";
import { IconEye, IconEyeOff } from "@/components/icons";

export function PasswordInput({ className = "", ...props }: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${INPUT_CLASS} pr-11 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-ink-400 transition-colors hover:text-ink-700 focus:outline-none"
      >
        {visible ? (
          <IconEyeOff className="h-5 w-5" />
        ) : (
          <IconEye className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}
