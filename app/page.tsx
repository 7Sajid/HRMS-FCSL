// Placeholder. Replaced in F2 by the role-aware redirect: signed out goes to
// /signin, Stage 1 goes to /onboarding, everyone else to their panel's home.
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-[11px] font-semibold tracking-widest text-ink-400">
        FIRST CAPITAL SECURITIES LIMITED
      </p>
      <h1 className="mt-2 text-2xl font-bold">HR Management System</h1>
      <p className="mt-2 text-sm text-ink-500">Foundation scaffold — not yet wired up.</p>
      <div className="mt-8 rounded-xl border border-ink-300/40 bg-white p-6">
        <p className="text-sm text-ink-700">
          Design tokens check:{" "}
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-500">
            brand
          </span>{" "}
          <span className="rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-500">
            success
          </span>{" "}
          <span className="rounded-full bg-warn-50 px-2.5 py-1 text-xs font-medium text-warn-500">
            warn
          </span>
        </p>
      </div>
    </main>
  );
}
