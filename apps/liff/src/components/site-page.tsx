import { notFound } from "next/navigation";
import { SiteView } from "@/components/site-view";
import { apiClient } from "@/lib/api/server";
import type { GuardBoothMode } from "@/lib/parking/guard-booth";
import { vehiclePreference } from "@/lib/vehicle-session";

export async function SitePage({ siteId, guardBooth, fitPreviewEnabled, entranceClip, mockBooth }: { siteId: string; guardBooth?: GuardBoothMode; fitPreviewEnabled?: boolean; entranceClip?: boolean; mockBooth?: boolean }) {
  if (!guardBooth && !(await vehiclePreference())?.model_id) return null;
  if (guardBooth && siteId !== "sripatum") notFound();
  const client = apiClient();
  const [sites, lotModel] = await Promise.all([
    client.GET("/api/sites"),
    client.GET("/api/sites/{site_id}/lot-model", { params: { path: { site_id: siteId } } }),
  ]);
  const site = sites.data?.find((item) => item.site_id === siteId);
  if (!site || lotModel.response.status === 404 || lotModel.response.status === 422) notFound();
  if (!lotModel.data) throw new Error(`Lot model request failed with ${lotModel.response.status}`);
  return <SiteView siteId={siteId} siteName={site.name} lotModel={lotModel.data} guardBooth={guardBooth} fitPreviewEnabled={fitPreviewEnabled} entranceClip={entranceClip} mockBooth={mockBooth} />;
}
