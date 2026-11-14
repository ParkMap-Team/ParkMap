import { SitePage } from "@/components/site-page";

export default async function GuardBoothPage({ params, searchParams }: PageProps<"/sites/[siteId]/guard-booth">) {
  const [{ siteId }, { preview }] = await Promise.all([params, searchParams]);
  const guardBooth = preview === "known" ? "preview" : preview === "unknown" ? "unknown" : "waiting";
  return <SitePage siteId={siteId} guardBooth={guardBooth} />;
}
