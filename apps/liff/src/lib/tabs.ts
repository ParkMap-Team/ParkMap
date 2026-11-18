export type TabId = "map" | "parked" | "nearby" | "settings";

/** The map screens: the home map and a site's map. The Guard Booth is not one. */
export function isMapPath(pathname: string): boolean {
  return pathname === "/" || /^\/sites\/[^/]+\/?$/.test(pathname);
}

/** The tab a path belongs to, or `null` for a screen outside the tabs. */
export function activeTab(pathname: string): TabId | null {
  if (isMapPath(pathname)) return "map";
  const [, first] = pathname.split("/");
  return first === "parked" || first === "nearby" || first === "settings" ? first : null;
}
