import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import { progressFor } from "@/lib/documents";

/**
 * Stage 1. Deliberately NOT behind requireOpenPanel — this is the one screen
 * on the other side of the door.
 */
export default async function Page() {
  const context = await requireUser();
  if (context.user.mustChangePassword) redirect("/set-password");
  // Somebody already through the door has no business here.
  if (!context.employee || context.employee.onboardingStatus === "APPROVED") {
    redirect(homePathFor(context.viewer));
  }

  const progress = progressFor(context.employee.staffType, new Set());

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow="STAGE 1"
        title="Upload my documents"
        subtitle="Your panel opens once HR has checked these."
      />
      <p className="mb-4 text-sm text-ink-500">{progress.label}</p>
      <EmptyState>Not built yet — P1.1.</EmptyState>
    </main>
  );
}
