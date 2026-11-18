import { redirect } from "next/navigation";

// The app serves one lot, so the old site list opens its map.
export default function SitesPage() {
  redirect("/");
}
