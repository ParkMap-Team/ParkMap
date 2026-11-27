import type { QueryClient } from "@tanstack/react-query";

/** A quick cancel must not arrive before the allocation it is meant to release. */
export async function waitForRecommendationRequests(client: QueryClient): Promise<void> {
  const filters = { mutationKey: ["line-parking-recommendation-request"] };
  if (!client.isMutating(filters)) return;
  await new Promise<void>(resolve => {
    const unsubscribe = client.getMutationCache().subscribe(() => {
      if (!client.isMutating(filters)) { unsubscribe(); resolve(); }
    });
    if (!client.isMutating(filters)) { unsubscribe(); resolve(); }
  });
}

export async function cancelRecommendation(send: typeof fetch = fetch): Promise<void> {
  const response = await send("/api/sites/sripatum/parking-recommendation", { method: "DELETE", cache: "no-store" });
  if (!response.ok && response.status !== 404) throw new Error("ยกเลิกคำแนะนำไม่สำเร็จ กรุณาลองอีกครั้ง");
}
