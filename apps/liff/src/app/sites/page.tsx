import type { Metadata } from "next";
import { SiteList } from "@/components/site-list";
import { apiClient } from "@/lib/api/server";

export const metadata: Metadata = { title: "เลือกลานจอด | ParkMap" };

// Sites come from the API at request time, never from a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const { data: sites } = await apiClient().GET("/api/sites");
  return <SiteList sites={sites} />;
}
