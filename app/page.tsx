import { Dashboard } from "@/components/layout/Dashboard";
import { buildInitialData } from "@/lib/data/sample";

export const dynamic = "force-static";

export default function Home() {
  return <Dashboard initial={buildInitialData()} />;
}
