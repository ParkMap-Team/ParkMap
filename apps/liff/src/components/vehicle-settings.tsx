"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Drawer } from "@base-ui/react/drawer";
import { Check, ChevronRight, CircleHelp, Info, MessageCircle, Motorbike, Search, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLineProfile, useVehicle } from "@/components/vehicle-gate";
import { useMutationState, useQuery } from "@tanstack/react-query";
import type { GuardBoothFit } from "@/lib/api/types";
import { vehicleChangeLocked, VEHICLE_CHANGE_LOCK_MESSAGE } from "@/lib/vehicle-change-lock";
import { lineOaId, reportChatUrl, shortCommit } from "@/lib/app-info";
import type { Preference } from "@/lib/vehicle-session";
import { modelMatches, UNSPECIFIED_MODEL } from "@/lib/vehicle-search";

// Both are inlined at build time (see the Dockerfile); either may be missing in local development.
const VERSION = shortCommit(process.env.NEXT_PUBLIC_APP_COMMIT);
const OA_ID = lineOaId(process.env.NEXT_PUBLIC_LINE_OA_ID);

/** One row of a settings group; the ring sits inside because the group clips its rounded corners. */
const ROW = "flex min-h-14 w-full items-center gap-3 px-4 text-left outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 active:bg-accent motion-reduce:transition-none";

/**
 * The settings tab: who is signed in, then grouped rows in the style of a phone's own settings. The
 * rider's model opens a searchable sheet, and choosing one saves it straight away, so there is no
 * separate save button.
 */
export function VehicleSettings() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6 motion-safe:animate-screen-enter">
      {/* LINE's own header already shows the page name, so the heading is for screen readers only. */}
      <h1 className="sr-only">ตั้งค่า</h1>
      <LineAccount />
      <VehicleModel />
      <About />
    </main>
  );
}

function Group({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6">
      <h2 id={id} className="px-1 pb-2 text-sm text-muted-foreground">{title}</h2>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card">{children}</div>
      {footer}
    </section>
  );
}

// Help lives here and in the rich menu rather than in the tab bar, since most riders open it once.
function About() {
  return (
    <Group title="เกี่ยวกับ" footer={OA_ID && <p className="px-1 pt-2 text-sm text-pretty text-muted-foreground">เปิดแชท LINE ของ ParkMap เพื่อส่งข้อความหาทีมงาน</p>}>
      <Link href="/help" className={ROW}>
        <CircleHelp aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">วิธีใช้งาน</span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      {OA_ID && (
        <a href={reportChatUrl(OA_ID, VERSION)} className={ROW}>
          <MessageCircle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">แจ้งปัญหาหรือติดต่อทีมงาน</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      )}
      {VERSION && (
        <div className="flex min-h-14 items-center gap-3 px-4">
          <Info aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1">เวอร์ชัน</span>
          <span className="font-mono text-sm text-muted-foreground">{VERSION}</span>
        </div>
      )}
    </Group>
  );
}

function LineAccount() {
  const profile = useLineProfile();
  return (
    <section aria-label="บัญชี LINE" className="flex items-center gap-3 rounded-2xl border bg-card p-4">
      <span aria-hidden className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-title font-semibold text-secondary-foreground">
        {profile?.picture ? (
          // Straight from LINE's CDN, so the picture's address never passes through ParkMap's server.
          <Image src={profile.picture} alt="" width={56} height={56} unoptimized className="size-full object-cover" />
        ) : profile ? (
          profile.initial
        ) : (
          <UserRound className="size-6 text-muted-foreground" />
        )}
      </span>
      <div key={profile?.name} className="min-w-0 motion-safe:animate-content-swap">
        <p className="truncate font-semibold">{profile?.name ?? "บัญชี LINE"}</p>
        <p className="text-sm text-muted-foreground">{profile ? "เข้าสู่ระบบด้วย LINE" : "เข้าสู่ระบบแล้ว"}</p>
      </div>
    </section>
  );
}

function VehicleModel() {
  const id = useId();
  const { preference, save } = useVehicle();
  const recommendation = useQuery<GuardBoothFit | null>({
    queryKey: ["line-parking-recommendation", "sripatum"],
    queryFn: async () => {
      const response = await fetch("/api/sites/sripatum/parking-recommendation", { cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("ตรวจสถานะคำแนะนำไม่ได้");
      return response.json();
    },
    staleTime: 0, refetchOnMount: "always", refetchInterval: 4000, retry: false,
  });
  const requests = useMutationState({ filters: { mutationKey: ["line-parking-recommendation-request"], status: "pending" } });
  const cancellations = useMutationState({ filters: { mutationKey: ["line-parking-recommendation-cancel"], status: "pending" } });
  const locked = vehicleChangeLocked(recommendation.data) || requests.length > 0 || cancellations.length > 0;
  const checking = recommendation.isPending || recommendation.isError;
  const [open, setOpen] = useState(false);
  // The model being saved; the row shows it at once and falls back to the stored one if saving fails.
  const [pending, setPending] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState(0);
  const model = pending ?? preference.model_id;
  const selected = preference.models.find((item) => item.id === model) ?? null;
  const label = selected?.label ?? "เลือกรุ่นรถ";

  async function choose(modelId: string) {
    if (locked || checking) return;
    setPending(modelId); setConfirmed(false); setError("");
    try {
      await save(modelId);
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setFailures((count) => count + 1);
    } finally { setPending(null); }
  }

  function pick(modelId: string) {
    setOpen(false);
    if (modelId !== model) void choose(modelId);
  }

  const footer = (
    <>
      <div className="flex min-h-6 items-start justify-between gap-3 px-1 pt-2 text-sm">
        <p id={`${id}-hint`} className="text-pretty text-muted-foreground">{locked ? VEHICLE_CHANGE_LOCK_MESSAGE : checking ? "กำลังตรวจสถานะคำแนะนำ กรุณารอสักครู่หรือลองเปิดหน้านี้ใหม่" : "ใช้หาที่ว่างที่รถรุ่นนี้จอดได้พอดี"}</p>
        {confirmed && (
          <p role="status" className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Check aria-hidden className="size-4 motion-safe:animate-icon-pop" />
            บันทึกแล้ว
          </p>
        )}
      </div>
      {error && <p id={`${id}-error`} key={failures} role="alert" className="px-1 pt-1 text-sm font-semibold text-destructive motion-safe:animate-error-shake">{error}</p>}
    </>
  );

  return (
    <Group title="รถของฉัน" footer={footer}>
      <Drawer.Root open={open && !locked && !checking} onOpenChange={setOpen}>
        <Drawer.Trigger
          disabled={pending !== null || locked || checking}
          aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
          className={`${ROW} ${pending !== null ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
        >
          <Motorbike aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="shrink-0">รุ่นรถ</span>
          <span key={label} className="min-w-0 flex-1 truncate text-right text-muted-foreground motion-safe:animate-content-swap">{label}</span>
          {pending ? <Spinner /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        </Drawer.Trigger>
        <ModelSheet models={preference.models} selected={selected} onPick={pick} />
      </Drawer.Root>
    </Group>
  );
}

type Model = Preference["models"][number];

/**
 * A bottom sheet listing every model with a search field on top. Picking one closes the sheet and
 * saves it; a search with no match offers "ไม่ระบุ" instead of a dead end. The sheet extends 3rem
 * below the screen (the bleed) so an upward drag never shows a gap under it.
 */
function ModelSheet({ models, selected, onPick }: { models: Model[]; selected: Model | null; onPick(modelId: string): void }) {
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Drawer.VirtualKeyboardProvider>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black opacity-[calc(0.3*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-drawer data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup
            // A tap leaves the search unfocused so the keyboard does not cover the list; a mouse or keyboard goes straight to it.
            initialFocus={(type) => (type === "touch" ? true : searchRef.current)}
            className="-mb-12 flex h-[calc(min(85dvh,40rem)+3rem)] w-full max-w-md flex-col rounded-t-3xl bg-background pb-12 text-foreground shadow-lg outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-drawer data-swiping:select-none data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none"
          >
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-2 pb-3">
              <Drawer.Title className="text-title font-semibold">เลือกรุ่นรถ</Drawer.Title>
              <Drawer.Close aria-label="ปิด" className="grid size-9 place-items-center rounded-full bg-secondary text-secondary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <X aria-hidden className="size-5" />
              </Drawer.Close>
            </div>
            <Combobox.Root
              inline
              open
              items={models}
              value={selected}
              onValueChange={(item: Model | null) => onPick(item?.id ?? selected?.id ?? UNSPECIFIED_MODEL)}
              itemToStringLabel={(item: Model) => item.label}
              itemToStringValue={(item: Model) => item.id}
              isItemEqualToValue={(item: Model, value: Model) => item.id === value.id}
              filter={(item: Model, query) => modelMatches(item.label, query)}
            >
              <div className="shrink-0 px-4 pb-2">
                <label className="flex h-11 items-center gap-2 rounded-xl bg-secondary px-3 focus-within:ring-3 focus-within:ring-ring/50">
                  <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <Combobox.Input ref={searchRef} aria-label="ค้นหารุ่นรถ" placeholder="ค้นหา เช่น Click, NMAX" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
                </label>
              </div>
              <Drawer.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Combobox.Empty>
                  <div className="flex flex-col items-center gap-1 px-6 py-8 text-center motion-safe:animate-content-swap">
                    <p className="font-semibold">ไม่พบรุ่นนี้ในรายการ</p>
                    <p className="text-sm text-pretty text-muted-foreground">ถ้ารุ่นของคุณยังไม่มี เลือก “ไม่ระบุ” ไว้ก่อนได้</p>
                    <Button size="lg" className="mt-3" onClick={() => onPick(UNSPECIFIED_MODEL)}>เลือก “ไม่ระบุ”</Button>
                  </div>
                </Combobox.Empty>
                <Combobox.List>
                  {(item: Model) => (
                    <Combobox.Item key={item.id} value={item} className="flex min-h-12 cursor-default items-center gap-3 rounded-xl px-3 outline-none select-none data-highlighted:bg-accent data-selected:font-semibold">
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <Combobox.ItemIndicator>
                        <Check aria-hidden className="size-5 text-primary" />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Drawer.Content>
            </Combobox.Root>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.VirtualKeyboardProvider>
  );
}
