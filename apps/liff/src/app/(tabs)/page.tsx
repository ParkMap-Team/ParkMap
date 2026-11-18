import { vehiclePreference } from "@/lib/vehicle-session";
import { LiffRedirect } from "@/components/liff-redirect";
import { requestLotModel, SiteScreen } from "@/components/site-screen";
import { apiClient } from "@/lib/api/server";
import { homeSiteId } from "@/lib/home";

// Sites come from the API at request time, never from a build-time snapshot.
export const dynamic = "force-dynamic";

/** True when LIFF is about to forward a rich-menu link to another page of the app. */
function forwarding(state: string | string[] | undefined): boolean {
  if (typeof state !== "string" || state === "") return false;
  const path = state.split(/[?#]/, 1)[0];
  return path !== "" && path !== "/";
}

// The rich menu's main button opens here, so a student lands on the lot's map at once, never on a menu.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (forwarding((await searchParams)["liff.state"])) return <LiffRedirect />;
  if (!(await vehiclePreference())?.model_id) return null;
  const { data: sites } = await apiClient().GET("/api/sites");
  if (!sites) throw new Error("Site list request failed");
  const siteId = homeSiteId(sites, process.env.PARKMAP_DEFAULT_SITE_ID || undefined);
  const site = sites.find((item) => item.site_id === siteId);
  // The lot the app serves is missing from the API: a deployment fault, not a page the student mistyped.
  if (!site) throw new Error("Home site is missing from the site list");
  return <SiteScreen site={site} lotModel={requestLotModel(site.site_id)} />;
}
