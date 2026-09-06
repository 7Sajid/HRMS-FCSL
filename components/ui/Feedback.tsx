import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface text-ink-500",
  brand: "bg-brand-50 text-brand-500",
  success: "bg-success-50 text-success-500",
  warn: "bg-warn-50 text-warn-500",
  danger: "bg-red-50 text-red-600",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600" role="alert">
      {children}
    </p>
  );
}

export function NoticeBox({ tone = "brand", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-lg px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}
