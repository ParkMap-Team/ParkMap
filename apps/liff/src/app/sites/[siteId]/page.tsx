import { SitePage } from "@/components/site-page";

export default async function ParkingSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <SitePage siteId={siteId} />;
}
