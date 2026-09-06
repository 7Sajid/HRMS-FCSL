import type { ComponentProps, ReactNode } from "react";

export const INPUT_CLASS =
  "w-full rounded-lg border border-ink-300/60 bg-white px-4 py-3 text-sm outline-none placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-surface disabled:text-ink-500";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ml-1 text-brand-500">*</span>}
      </label>
      {children}
      {/* The hint is hidden once there is an error: two lines of small grey
          text under a field is how people miss the one that matters. */}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${INPUT_CLASS} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${INPUT_CLASS} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${INPUT_CLASS} ${className}`} {...props} />;
}
