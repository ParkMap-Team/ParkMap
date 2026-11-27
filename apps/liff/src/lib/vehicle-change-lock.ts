type Recommendation = { stage?: string | null } | null | undefined;

export const VEHICLE_CHANGE_LOCK_MESSAGE = "มีเส้นทางแนะนำที่จอดอยู่ เปลี่ยนรุ่นรถได้เมื่อคำแนะนำสิ้นสุดแล้ว";

export function vehicleChangeLocked(recommendation: Recommendation): boolean {
  return recommendation?.stage === "HELD" || recommendation?.stage === "AWAITING_CONFIRMATION";
}

/** The LIFF update route checks authoritative state again before saving. */
export async function checkVehicleChange(read: () => Promise<Recommendation>): Promise<Response | null> {
  try {
    return vehicleChangeLocked(await read())
      ? Response.json({ detail: VEHICLE_CHANGE_LOCK_MESSAGE }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
      : null;
  } catch {
    return Response.json({ detail: "ตรวจสถานะคำแนะนำไม่ได้ กรุณาลองใหม่" }, { status: 503 });
  }
}
