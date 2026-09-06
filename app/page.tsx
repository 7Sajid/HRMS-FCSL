import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";

/**
 * The front door. Nobody stays here — where a person lands depends on who they
 * are and whether their documents have been approved.
 */
export default async function Home() {
  const context = await getSessionContext();
  if (!context) redirect("/signin");
  if (context.user.mustChangePassword) redirect("/set-password");
  if (context.employee && context.employee.onboardingStatus !== "APPROVED") redirect("/onboarding");
  redirect(homePathFor(context.viewer));
}
