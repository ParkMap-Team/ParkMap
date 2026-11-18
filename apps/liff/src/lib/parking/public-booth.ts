/** Public access is limited to the configured Sripatum booth surface. */
export function isPublicBoothPath(path: string): boolean {
  return path === "/sites/sripatum/guard-booth" || path === "/sites/sripatum/guard-booth/";
}
