"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Cctv, Motorbike } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CAMPUS_BOUNDS, type NearbyPlace } from "@/lib/nearby/places";
import { cn } from "@/lib/utils";

// A street map that always opens on the campus grounds, with a pin per place within RADIUS_M of it
// (ADR 0022). The free OpenFreeMap tiles need no key and see only which tiles the map asks for.

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const CAMPUS_PADDING = 24;

type Library = typeof import("maplibre-gl");

// Lots with cameras, places the team checked, and OpenStreetMap's places each have their own colour.
const PIN_COLOUR: Record<NearbyPlace["kind"], { body: string; tip: string }> = {
  CAMERA: { body: "bg-primary text-primary-foreground", tip: "border-t-primary" },
  CAMPUS: { body: "bg-[#0f766e] text-white", tip: "border-t-[#0f766e]" },
  NEARBY: { body: "bg-[#0f766e] text-white", tip: "border-t-[#0f766e]" },
  OSM: { body: "bg-[#475569] text-white", tip: "border-t-[#475569]" },
};

function Pin({ place, selected, onSelect }: { place: NearbyPlace; selected: boolean; onSelect(): void }) {
  const colour = PIN_COLOUR[place.kind];
  return (
    <button
      type="button"
      aria-label={place.name}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "relative grid size-11 origin-bottom place-items-center rounded-full shadow-md ring-[3px] ring-white transition-transform duration-150 ease-out motion-reduce:transition-none",
        colour.body,
        selected && "scale-125",
      )}
    >
      {place.kind === "CAMERA" ? <Cctv className="size-5" /> : <Motorbike className="size-5" />}
      <span aria-hidden className={cn("absolute top-full left-1/2 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent", colour.tip)} />
    </button>
  );
}

export function NearbyMap({
  places,
  selectedId,
  onSelect,
  onFail,
}: {
  places: readonly NearbyPlace[];
  selectedId: string | null;
  onSelect(id: string): void;
  onFail(): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<{ map: MapLibreMap; library: Library } | null>(null);
  // The marker elements the pins render into, by place id.
  const [pins, setPins] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const fail = useEffectEvent(onFail);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      try {
        const library = await import("maplibre-gl");
        if (cancelled || !container.current) return;
        // The library looks for its worker beside its own file, which the bundle does not keep; this
        // reference makes the bundler ship the worker and gives its URL.
        library.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        map = new library.Map({
          container: container.current,
          style: STYLE_URL,
          // Always opens on the campus, never on the pins or the rider; places further out are a pan away.
          bounds: CAMPUS_BOUNDS,
          fitBoundsOptions: { padding: CAMPUS_PADDING },
          maxZoom: 19,
          attributionControl: { compact: true },
          // North stays up, so the map reads like the campus plan.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        // Tiles and fonts that fail to load leave gaps, not a broken page; the pins and their sheets still work.
        map.on("error", ({ error }) => console.error("Nearby map resource failed", error));
        const elements = new Map<string, HTMLElement>();
        for (const place of places) {
          const element = document.createElement("div");
          new library.Marker({ element, anchor: "bottom", offset: [0, -9] }).setLngLat([place.longitude, place.latitude]).addTo(map);
          elements.set(place.id, element);
        }
        view.current = { map, library };
        setPins(elements);
      } catch (error) {
        // No WebGL, or the library failed to load: the page shows the places as a list.
        console.error("Nearby map failed", error);
        if (!cancelled) fail();
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      view.current = null;
    };
  }, [places]);

  // The selected pin rises above the others and comes into view.
  useEffect(() => {
    for (const [id, element] of pins) element.style.zIndex = id === selectedId ? "1" : "";
    const place = places.find((item) => item.id === selectedId);
    if (place && view.current) view.current.map.easeTo({ center: [place.longitude, place.latitude] });
  }, [pins, places, selectedId]);

  // The library's stylesheet sets `position: relative` on its container and outranks the layered
  // utilities, so the outer box places the map and the library styles only the inner one.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="size-full" />
      {[...pins].map(([id, element]) => {
        const place = places.find((item) => item.id === id);
        return place && createPortal(<Pin place={place} selected={id === selectedId} onSelect={() => onSelect(id)} />, element, id);
      })}
    </div>
  );
}
