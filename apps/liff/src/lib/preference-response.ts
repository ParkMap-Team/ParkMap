/** An opening probe may have no session yet; protected reads still require one. */
export function preferenceResponse(data: unknown | null, optional: boolean): Response {
  const headers = { "Cache-Control": "private, no-store" };
  if (data == null && optional) return new Response(null, { status: 204, headers });
  return Response.json(data ?? { detail: "กรุณาเข้าสู่ระบบ LINE อีกครั้ง" }, {
    status: data == null ? 401 : 200, headers,
  });
}
