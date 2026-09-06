import { requireOpenPanel } from "@/lib/auth";

/**
 * The locked door, enforced for this whole branch of the site (§3).
 *
 * It lives in a layout rather than in each page so that a page added later
 * cannot forget it. A layout redirect happens before the page renders, so
 * there is no window in which a Stage 1 account sees anything behind the door.
 *
 * Pages still call requireCapability for their own specific power. Two checks,
 * because the cost of the second one is a cached function call and the cost of
 * missing the first is somebody reading a staff file they should not.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOpenPanel();
  return <>{children}</>;
}
