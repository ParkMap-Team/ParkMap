"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Preference } from "@/lib/vehicle-session";

export function VehicleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const exempt = pathname === "/mobile-camera" || pathname === "/help";
  const [preference, setPreference] = useState<Preference | null>(null);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  async function initialize() {
    setError("");
    try {
      if (process.env.NODE_ENV === "development") {
        const response = await fetch("/api/vehicle-preference", { cache: "no-store" });
        if (!response.ok) throw new Error("โหลดการตั้งค่าทดสอบไม่สำเร็จ");
        const data: Preference = await response.json();
        setPreference(data); setModel(data.model_id ?? "");
        return;
      }
      const { default: liff } = await import("@line/liff");
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) throw new Error("กรุณาเปิด ParkMap ผ่าน LINE");
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        if (liff.isInClient()) { setNeedsLogin(true); throw new Error("กรุณาปิดหน้า ParkMap แล้วเปิดจากเมนู OA ใหม่"); }
        liff.login({ redirectUri: window.location.href }); return;
      }
      const token = liff.getAccessToken();
      if (!token) { setNeedsLogin(true); throw new Error("กรุณาเข้าสู่ระบบ LINE ใหม่"); }
      const cached = await fetch("/api/vehicle-preference", { cache: "no-store" });
      const response = await fetch("/api/vehicle-preference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }) });
      if (!response.ok) {
        setNeedsLogin(response.status === 401);
        throw new Error(response.status === 401 ? "การเข้าสู่ระบบ LINE หมดอายุ กรุณาเปิด ParkMap ใหม่" : "ยืนยันบัญชีไม่สำเร็จ กรุณาลองใหม่");
      }
      setNeedsLogin(false);
      const data: Preference = await response.json();
      setPreference(data); setModel(data.model_id ?? "");
      // Refresh server-rendered map content after a new session is established.
      if (data.model_id && pathname !== "/settings" && !cached.ok) window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ"); }
  }
  async function retry() {
    if (!needsLogin) { await initialize(); return; }
    const { default: liff } = await import("@line/liff");
    if (liff.isInClient()) { liff.closeWindow(); return; }
    liff.logout();
    liff.login({ redirectUri: window.location.href });
  }
  useEffect(() => { if (!exempt) void initialize(); }, [exempt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (exempt) return children;
  if (!preference) return <main className="mx-auto max-w-md space-y-4 p-6"><h1 className="text-xl font-bold">ParkMap</h1><p role="status">{error || "กำลังตรวจสอบรุ่นรถของคุณ…"}</p>{error && <button onClick={() => void retry()} className="rounded-xl bg-pink-600 px-5 py-3 text-white">{needsLogin ? "ปิดหน้านี้แล้วเปิด ParkMap ใหม่" : "ลองใหม่"}</button>}</main>;
  if (preference.model_id && pathname !== "/settings") return children;
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vehicle-preference", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_id: model }) });
      if (!response.ok) throw new Error("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      window.location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); setBusy(false); }
  }
  return <main className="mx-auto max-w-md space-y-5 px-5 py-8"><p className="font-bold text-pink-700">PARKMAP</p><h1 className="text-2xl font-bold">ตั้งค่ารุ่นรถของฉัน</h1><p className="text-sm text-muted-foreground">เลือกรุ่นรถและบันทึกก่อนเข้าไปดูแผนที่</p><label className="block space-y-2"><span>รุ่นรถของคุณ</span><select value={model} onChange={e => setModel(e.target.value)} className="w-full rounded-xl border bg-background p-3"><option value="" disabled>เลือกรุ่นรถ</option>{preference.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{error && <p role="alert" className="text-red-700">{error}</p>}<button disabled={!model || busy} onClick={() => void save()} className="w-full rounded-xl bg-pink-600 p-3 font-semibold text-white disabled:opacity-40">{busy ? "กำลังบันทึก…" : "บันทึกและดูแผนที่"}</button></main>;
}
