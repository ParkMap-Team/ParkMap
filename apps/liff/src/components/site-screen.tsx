import { notFound } from "next/navigation";
import { SiteView } from "@/components/site-view";
import { apiClient } from "@/lib/api/server";
import type { SiteSummary } from "@/lib/api/types";

/** Starts loading a site's lot model, so a page can fetch it alongside the site list. */
export function requestLotModel(siteId: string) {
  return apiClient().GET("/api/sites/{site_id}/lot-model", { params: { path: { site_id: siteId } } });
}

// One site's map, shared by the home screen and /sites/[siteId]. Parking state is not rendered on the
// server: the browser polls it and judges its age on its own clock, so a server snapshot could look
// fresher than it is.
export async function SiteScreen({
  site,
  siteCount,
  lotModel: request,
}: {
  site: SiteSummary;
  siteCount: number;
  lotModel: ReturnType<typeof requestLotModel>;
}) {
  const lotModel = await request;
  if (lotModel.response.status === 404 || lotModel.response.status === 422) notFound();
  if (!lotModel.data) throw new Error(`Lot model request failed with ${lotModel.response.status}`);
  return <SiteView siteId={site.site_id} siteName={site.name} lotModel={lotModel.data} listHref={siteCount > 1 ? "/sites" : null} />;
}
