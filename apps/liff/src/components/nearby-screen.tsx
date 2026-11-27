"use client";

import { Drawer } from "@base-ui/react/drawer";
import { Cctv, ChevronRight, Motorbike, Navigation, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NearbyMap } from "@/components/nearby-map";
import { Button } from "@/components/ui/button";
import { directionsUrl } from "@/lib/nearby/distance";
import type { NearbyPlace } from "@/lib/nearby/places";
import { cn } from "@/lib/utils";

// Motorcycle parking within 2 km of the campus (ADR 0022). The map shows only pins; tapping one opens its details. The page
// never asks for the rider's position; Google Maps finds the start of the directions itself.

const KIND_TEXT: Record<NearbyPlace["kind"], string> = {
  CAMERA: "ลานที่มีกล้อง ดูที่ว่างได้",
  CAMPUS: "ในมหาวิทยาลัย",
  NEARBY: "ใกล้มหาวิทยาลัย",
  OSM: "จาก OpenStreetMap",
};

const ICON_COLOUR: Record<NearbyPlace["kind"], string> = {
  CAMERA: "text-primary",
  CAMPUS: "text-[#0f766e]",
  NEARBY: "text-[#0f766e]",
  OSM: "text-[#475569]",
};

function KindIcon({ place }: { place: NearbyPlace }) {
  const className = cn("size-5 shrink-0", ICON_COLOUR[place.kind]);
  return place.kind === "CAMERA" ? <Cctv className={className} /> : <Motorbike className={className} />;
}

/** Inside LINE, Google Maps opens outside the LIFF browser, so its app can take over. */
function DirectionsLink({ place }: { place: NearbyPlace }) {
  const url = directionsUrl(place);
  const [liff, setLiff] = useState<typeof import("@line/liff").default | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@line/liff").then(({ default: sdk }) => {
      if (!cancelled && sdk.isInClient()) setLiff(sdk);
    }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Button
      className="h-11 gap-2"
      nativeButton={false}
      render={
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (!liff) return;
            event.preventDefault();
            liff.openWindow({ url, external: true });
          }}
        />
      }
    >
      <Navigation />
      นำทางด้วย Google Maps
    </Button>
  );
}

function Fact({ term, value }: { term: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{value ?? "ยังไม่มีข้อมูล"}</dd>
    </>
  );
}

/**
 * The tapped place's details in a bottom sheet. It is not modal: the map stays live above it, so
 * another pin can be tapped straight away. It extends 3rem below the screen (the bleed) so an upward
 * drag never shows a gap under it.
 */
function PlaceSheet({ place, open, onClose }: { place: NearbyPlace | null; open: boolean; onClose(): void }) {
  return (
    <Drawer.Root open={open} onOpenChange={(next) => !next && onClose()} modal={false} disablePointerDismissal>
      <Drawer.Portal>
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup
            initialFocus={false}
            className="pointer-events-auto -mb-12 flex max-h-[calc(min(70dvh,36rem)+3rem)] w-full max-w-md flex-col rounded-t-3xl bg-background pb-12 text-foreground shadow-[0_-8px_32px_rgb(0_0_0/0.18)] outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-drawer data-swiping:select-none data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none"
          >
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
            {place && (
              <>
                <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-3">
                  <KindIcon place={place} />
                  <div className="min-w-0 flex-1">
                    <Drawer.Title className="font-semibold">{place.name}</Drawer.Title>
                    <Drawer.Description className="text-sm text-muted-foreground">
                      {KIND_TEXT[place.kind]}
                    </Drawer.Description>
                  </div>
                  <Drawer.Close aria-label="ปิด" className="-mt-1 grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <X aria-hidden className="size-5" />
                  </Drawer.Close>
                </div>
                <Drawer.Content className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <PlaceDetails place={place} />
                </Drawer.Content>
              </>
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function PlaceDetails({ place }: { place: NearbyPlace }) {
  return (
    <>
      {place.photos.length > 0 && (
        <div role="group" aria-label={`รูปที่จอด ${place.name}`} className={`grid gap-2 ${place.photos.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {place.photos.map((photo, index) => (
            <div key={photo} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
              <Image src={`/nearby/${photo}`} alt={`ที่จอด ${place.name} ภาพที่ ${index + 1}`} fill sizes={place.photos.length > 1 ? "(min-width: 28rem) 14rem, 50vw" : "(min-width: 28rem) 28rem, 100vw"} className="object-cover" />
            </div>
          ))}
        </div>
      )}
      {place.kind === "CAMERA" ? (
        <Button variant="outline" className="h-11 w-full" render={<Link href={`/sites/${place.siteId}`} />} nativeButton={false}>
          ดูที่ว่างในลานนี้
        </Button>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Fact term="ค่าจอด" value={place.fee} />
            <Fact term="เวลาเปิด" value={place.hours} />
            <Fact term="หลังคา" value={place.covered === null ? null : place.covered ? "มีหลังคา" : "ไม่มีหลังคา"} />
          </dl>
          <p className="text-xs text-muted-foreground">ที่นี่ไม่มีกล้อง ParkMap จึงไม่รู้ว่าตอนนี้มีที่ว่างหรือไม่</p>
          {place.kind === "OSM" && (
            <p className="text-xs text-muted-foreground">
              ข้อมูลจาก{" "}
              <a className="underline underline-offset-2" href={`https://www.openstreetmap.org/${place.osm}`} target="_blank" rel="noopener noreferrer">
                OpenStreetMap
              </a>{" "}
              ซึ่งใครก็แก้ได้ อาจไม่ครบหรือไม่เป็นปัจจุบัน
            </p>
          )}
        </>
      )}
      <div className="grid">
        <DirectionsLink place={place} />
      </div>
    </>
  );
}

/** Only when the map cannot start: the places as a list, so every one stays reachable. */
function PlaceList({ places, onSelect }: { places: readonly NearbyPlace[]; onSelect(id: string): void }) {
  if (places.length === 0) return <p className="px-4 pt-4 text-sm text-muted-foreground">ยังไม่มีที่จอดในรายการ</p>;
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-2 pt-2 pb-4">
      <p className="px-2 pb-2 text-sm text-muted-foreground">แสดงแผนที่ไม่ได้ในตอนนี้ เลือกจากรายการด้านล่างได้</p>
      <ul aria-label="ที่จอดรถ">
        {places.map((place) => (
          <li key={place.id}>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => onSelect(place.id)}>
              <KindIcon place={place} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{place.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {KIND_TEXT[place.kind]}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NearbyScreen({ places }: { places: readonly NearbyPlace[] }) {
  // The sheet keeps the last place while it slides away, so `open` closes it and `selectedId` stays.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const selected = places.find((place) => place.id === selectedId) ?? null;

  function select(id: string) {
    setSelectedId(id);
    setOpen(true);
  }

  return (
    <main className="relative flex min-h-0 flex-1 flex-col bg-muted text-foreground">
      <h1 className="sr-only">ที่จอดรถใกล้ฉัน</h1>
      <section aria-label="แผนที่ที่จอดรถในรัศมี 2 กม. จากมหาวิทยาลัย" className="relative min-h-0 flex-1 overflow-hidden">
        {mapFailed ? (
          <PlaceList places={places} onSelect={select} />
        ) : (
          <NearbyMap places={places} selectedId={open ? selectedId : null} onSelect={select} onFail={() => setMapFailed(true)} />
        )}
      </section>
      <PlaceSheet place={selected} open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
