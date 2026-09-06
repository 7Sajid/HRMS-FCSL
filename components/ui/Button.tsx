import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Three variants and no more. A fourth is nearly always a badge, a link, or a
 * primary button that somebody wanted to look calmer.
 */
type Variant = "primary" | "secondary" | "danger" | "ghost";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600",
  secondary: "border border-ink-300/60 bg-white text-ink-900 hover:bg-surface",
  // Destructive uses stock red, not a brand token. There is no FCSL red, and
  // inventing one would put the company colour on the delete button.
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-ink-500 hover:bg-surface hover:text-ink-900",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; children: ReactNode }) {
  return (
    <Link className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props}>
      {children}
    </Link>
  );
}
