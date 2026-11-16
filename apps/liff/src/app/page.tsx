import { LiffRedirect } from "@/components/liff-redirect";
import { SiteList } from "@/components/site-list";
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

// The rich menu's main button opens here, so a student lands on a map, not on a menu: the configured
// default site, else the only site, else the list.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (forwarding((await searchParams)["liff.state"])) return <LiffRedirect />;
  const { data: sites } = await apiClient().GET("/api/sites");
  const siteId = sites ? homeSiteId(sites, process.env.PARKMAP_DEFAULT_SITE_ID) : null;
  const site = sites?.find((item) => item.site_id === siteId);
  return site && sites ? <SiteScreen site={site} siteCount={sites.length} lotModel={requestLotModel(site.site_id)} /> : <SiteList sites={sites} />;
}
