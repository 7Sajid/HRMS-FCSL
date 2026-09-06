import type { ReactNode } from "react";

/**
 * Wide tables scroll inside their own container. The page body must never
 * scroll sideways — a branch attendance grid is thirty-one columns wide and a
 * phone is not.
 */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-300/40 bg-white">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-ink-300/40 bg-surface text-xs uppercase tracking-wide text-ink-400">
      {children}
    </thead>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-ink-300/20">{children}</tbody>;
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-5 py-3 ${className}`}>{children}</td>;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-8 text-center text-ink-400">
        {children}
      </td>
    </tr>
  );
}
