// The settings postback must have a live handler before replacing the LINE menu.
export async function requireBotReady(rawUrl: string | undefined, fetcher: typeof fetch = fetch): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl?.trim() ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/health")
      throw new Error();
  } catch {
    throw new Error("Set LINE_BOT_HEALTH_URL to the bot's public HTTPS /api/health URL.");
  }
  try {
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
    const health: unknown = await response.json();
    if (!response.ok || !health || typeof health !== "object" || !("status" in health) || health.status !== "ok"
      || !("service" in health) || health.service !== "parkmap-line-bot") throw new Error();
  } catch {
    throw new Error("LINE bot is not ready. Deploy and verify the bot before publishing the settings menu.");
  }
}
