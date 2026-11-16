import { SitePage } from "@/components/site-page";
import { guardBoothFitEnabled } from "@/lib/parking/guard-booth-server";

export default async function GuardBoothPage({ params, searchParams }: PageProps<"/sites/[siteId]/guard-booth">) {
  const [{ siteId }, { preview }] = await Promise.all([params, searchParams]);
  const guardBooth = preview === "known" ? "preview" : preview === "unknown" ? "unknown" : "waiting";
  return <SitePage siteId={siteId} guardBooth={guardBooth} fitPreviewEnabled={siteId === "sripatum" && guardBoothFitEnabled()} />;
}
