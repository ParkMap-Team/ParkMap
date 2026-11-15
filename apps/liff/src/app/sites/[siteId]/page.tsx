import { vehiclePreference } from "@/lib/vehicle-session";
import { notFound } from "next/navigation";
import { requestLotModel, SiteScreen } from "@/components/site-screen";
import { apiClient } from "@/lib/api/server";

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  if (!(await vehiclePreference())?.model_id) return null;
  const { siteId } = await params;
  const lotModel = requestLotModel(siteId);
  // Marks a failure handled when the page ends before awaiting it (no site, or no site list).
  lotModel.catch(() => undefined);
  const { data: sites } = await apiClient().GET("/api/sites");
  if (!sites) throw new Error("Site list request failed");
  const site = sites.find((item) => item.site_id === siteId);
  if (!site) notFound();
  return <SiteScreen site={site} siteCount={sites.length} lotModel={lotModel} />;
}
