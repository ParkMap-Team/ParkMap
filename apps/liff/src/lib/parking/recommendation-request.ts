/** Stable per-tab request IDs contain no LINE identity or vehicle image. */
export function parkingRequestId(storage: Pick<Storage, "getItem" | "setItem"> | null, key: string): string {
  const storedKey = `parkmap:recommendation:${key}`;
  try {
    const previous = storage?.getItem(storedKey);
    if (previous && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous)) return previous;
  } catch { /* Storage can be disabled; the current mounted screen still keeps its ID. */ }
  const id = crypto.randomUUID();
  try { storage?.setItem(storedKey, id); } catch { /* Keep the in-memory ID. */ }
  return id;
}

export function activeRecommendation(fit: { stage?: string | null; expires_at?: string | null; observed_at?: string | null; polygon?: unknown } | null | undefined, frame: string | null | undefined, now: number): boolean {
  return !!fit?.polygon && fit.stage === "HELD" && fit.observed_at === frame && !!fit.expires_at && now < Date.parse(fit.expires_at);
}

/** Translate elapsed client time onto the response's server clock. */
export function recommendationTime(serverTime: string | null | undefined, receivedAt: number, now: number): number {
  return serverTime ? Date.parse(serverTime) + Math.max(0, now - receivedAt) : now;
}

export function remainingHoldSeconds(expiresAt: string | null | undefined, serverTime: string | null | undefined, receivedAt: number, now: number): number {
  return expiresAt ? Math.min(120, Math.max(0, Math.ceil((Date.parse(expiresAt) - recommendationTime(serverTime, receivedAt, now)) / 1000))) : 0;
}

/** A revisited photo is a new entrance scene; refresh of a recent scene reuses its IDs. */
export function parkingSceneKey(storage: Pick<Storage, "getItem" | "setItem"> | null, siteId: string, frame: string, now: number): string {
  const key = `parkmap:scene:${siteId}`;
  let scene: { frame: string; id: string; seenAt: number } | undefined;
  try {
    const stored = storage?.getItem(key);
    if (stored) scene = JSON.parse(stored);
  } catch { /* New or unavailable storage. */ }
  const id = scene?.frame === frame && now - scene.seenAt < 120_000 && typeof scene.id === "string" ? scene.id : crypto.randomUUID();
  try { storage?.setItem(key, JSON.stringify({ frame, id, seenAt: now })); } catch { /* Current screen retains the occurrence. */ }
  return id;
}
