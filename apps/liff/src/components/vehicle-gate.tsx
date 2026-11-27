"use client";
import { createContext, use, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { Mascot, MascotLoading } from "@/components/mascot";
import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";
import { VehicleForm } from "@/components/vehicle-form";
import { BOOT_STEPS } from "@/lib/boot-progress";
import { lineProfile, type LineProfile } from "@/lib/line-profile";
import type { Preference } from "@/lib/vehicle-session";
import { isPublicBoothPath } from "@/lib/parking/public-booth";

// Development only: with NEXT_PUBLIC_PARKMAP_DEV_LINE_LOGIN=1 the gate skips LIFF and sends the token
// that scripts/dev-line-settings.mjs accepts, so the app runs in a desktop browser. The session route
// still verifies it upstream; production builds drop this branch, and the real service rejects it.
const DEV_LINE_TOKEN = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PARKMAP_DEV_LINE_LOGIN === "1"
  ? "local-dev-line-token"
  : null;

type Vehicle = { preference: Preference; save(modelId: string): Promise<void> };
const VehicleContext = createContext<Vehicle | null>(null);
const ProfileContext = createContext<LineProfile | null>(null);

/** The signed-in student's vehicle model and how to change it; only inside the gate. */
export function useVehicle(): Vehicle {
  const vehicle = use(VehicleContext);
  if (!vehicle) throw new Error("useVehicle is used outside VehicleGate");
  return vehicle;
}

/**
 * The signed-in student's LINE name and picture, or null while it loads, in development, or when the
 * LIFF app lacks the `profile` scope. Only the settings screen shows it; nothing waits on it.
 */
export function useLineProfile(): LineProfile | null {
  return use(ProfileContext);
}

/** Saves the model through the session proxy and returns the stored preference. */
async function savePreference(modelId: string): Promise<Preference> {
  const response = await fetch("/api/vehicle-preference", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_id: modelId }) });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่");
  }
  return response.json();
}

export function VehicleGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const exempt = pathname === "/mobile-camera" || pathname === "/help" || isPublicBoothPath(pathname);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // How many launch steps have finished; the loading screen fills its bar by this.
  const [done, setDone] = useState(0);
  async function initialize() {
    setError("");
    setDone(0);
    try {
      let token = DEV_LINE_TOKEN;
      if (!token) {
        const { default: liff } = await import("@line/liff");
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) throw new Error("กรุณาเปิด ParkMap ผ่าน LINE");
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          if (liff.isInClient()) { setNeedsLogin(true); throw new Error("กรุณาปิดหน้า ParkMap แล้วเปิดจากเมนู OA ใหม่"); }
          liff.login({ redirectUri: window.location.href }); return;
        }
        token = liff.getAccessToken();
        if (!token) { setNeedsLogin(true); throw new Error("กรุณาเข้าสู่ระบบ LINE ใหม่"); }
        // Without the profile scope LINE refuses this, and settings shows the account without a name.
        liff.getProfile().then((data) => setProfile(lineProfile(data)), () => setProfile(null));
      }
      setDone(1);
      const cached = await fetch("/api/vehicle-preference?optional=1", { cache: "no-store" });
      const response = await fetch("/api/vehicle-preference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }) });
      if (!response.ok) {
        setNeedsLogin(response.status === 401 && !DEV_LINE_TOKEN);
        throw new Error(response.status === 401 ? "การเข้าสู่ระบบ LINE หมดอายุ กรุณาเปิด ParkMap ใหม่" : "ยืนยันบัญชีไม่สำเร็จ กรุณาลองใหม่");
      }
      setNeedsLogin(false);
      const data: Preference = await response.json();
      setPreference(data);
      // Refresh server-rendered map content after a new session is established.
      if (data.model_id && pathname !== "/settings" && cached.status !== 200) window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ");
      setAttempt((count) => count + 1);
    }
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
  if (!preference) {
    if (!error) return <main className="grid flex-1 place-items-center bg-background p-4"><MascotLoading label={BOOT_STEPS[done]} progress={{ done, total: BOOT_STEPS.length }} /></main>;
    return (
      <MascotScreen mood="confused" title="เปิด ParkMap ไม่สำเร็จ" description={error} shakeKey={attempt}>
        <Button onClick={() => void retry()} className="h-11 px-5">{needsLogin ? "ปิดหน้านี้แล้วเปิด ParkMap ใหม่" : "ลองใหม่"}</Button>
      </MascotScreen>
    );
  }
  // A first visit chooses a model before any map; the server pages render nothing without one.
  if (!preference.model_id) {
    return (
      <main className="flex w-full flex-1 bg-primary text-primary-foreground">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,var(--safe-bottom))] motion-safe:animate-screen-enter">
          <section className="flex flex-col items-center text-center">
            <div className="grid size-56 place-items-center rounded-full bg-primary-foreground">
              <Mascot mood="happy" size={200} />
            </div>
            <p className="mt-4 text-sm text-primary-foreground/85">ยินดีต้อนรับ</p>
            <h1 className="mt-0.5 max-w-full truncate text-title font-semibold">{profile?.name ?? "มาเริ่มตั้งค่ารถกัน"}</h1>
            <p className="mt-2 text-sm text-primary-foreground/90">เลือกรุ่นรถเพื่อรับคำแนะนำที่จอดที่เหมาะกับรถของคุณ</p>
          </section>
          <VehicleForm models={preference.models} initial="" submitLabel="บันทึกและดูแผนที่" onSave={async (modelId) => {
            await savePreference(modelId);
            window.location.assign("/");
          }} />
        </div>
      </main>
    );
  }
  const vehicle: Vehicle = { preference, save: async (modelId) => {
    setPreference(await savePreference(modelId));
    await queryClient.invalidateQueries({ queryKey: ["parking-vehicle"] });
  } };
  return (
    <VehicleContext value={vehicle}>
      <ProfileContext value={profile}>{children}</ProfileContext>
    </VehicleContext>
  );
}
