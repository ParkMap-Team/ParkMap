/** Read from the server runtime so the same LIFF image can serve multiple environments. */
export function guardBoothFitEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env.PARKMAP_GUARD_BOOTH_FIT_PREVIEW === "1";
}
