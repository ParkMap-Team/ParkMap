/**
 * The site the home screen opens on, so a student coming from the LINE rich menu sees a map at once:
 * the configured default when it exists, else the only site, else none (the home screen lists them).
 */
export function homeSiteId(sites: readonly { site_id: string }[], defaultSiteId: string | undefined): string | null {
  if (defaultSiteId && sites.some((site) => site.site_id === defaultSiteId)) return defaultSiteId;
  return sites.length === 1 ? sites[0].site_id : null;
}
