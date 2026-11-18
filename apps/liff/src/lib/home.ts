/** The lot the app serves. `PARKMAP_DEFAULT_SITE_ID` overrides it, e.g. for a local fixture site. */
export const DEFAULT_SITE_ID = "sripatum";

/**
 * The site the home screen opens on, so a student coming from the LINE rich menu sees a map at once:
 * the configured site when it exists, else the only site, else none. There is no site picker.
 */
export function homeSiteId(sites: readonly { site_id: string }[], configured: string = DEFAULT_SITE_ID): string | null {
  if (sites.some((site) => site.site_id === configured)) return configured;
  return sites.length === 1 ? sites[0].site_id : null;
}
