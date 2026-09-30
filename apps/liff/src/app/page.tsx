import Link from "next/link";
import { apiClient } from "@/lib/api/server";

// Sites come from the API at request time, never from a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { data: sites } = await apiClient().GET("/api/sites");
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">ParkMap</h1>
      <p className="text-sm text-muted-foreground">เลือกลานจอดรถเพื่อดูพื้นที่ว่าง</p>
      {!sites ? (
        <p className="text-sm text-red-700">โหลดรายการลานจอดไม่ได้ ลองใหม่อีกครั้ง</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {sites.map((site) => (
            <li key={site.site_id}>
              <Link href={`/sites/${site.site_id}`} className="block px-4 py-3 hover:bg-muted">
                {site.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
