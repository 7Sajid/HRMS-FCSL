import { PanelLayout } from "@/components/PanelLayout";

export default async function Layout({ children }: { children: React.ReactNode }) {
  return <PanelLayout>{children}</PanelLayout>;
}
