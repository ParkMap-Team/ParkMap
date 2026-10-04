import type { messagingApi } from "@line/bot-sdk";

// Large rich menu. The image in this folder is drawn on the same grid.
export const MENU_SIZE = { width: 2500, height: 1686 } as const;
export const MENU_IMAGE = new URL("./rich-menu.jpg", import.meta.url);
// LINE accepts JPEG or PNG up to 1 MB. JPEG keeps the glossy logo art well under it.
export const MENU_IMAGE_TYPE = "image/jpeg";
export const MAX_IMAGE_BYTES = 1_000_000;

// The largest button opens the site list; the rest open paths of the same LIFF app.
// Tap areas meet in the middle of the 50px gutters between the tiles in rich-menu.html.
const BUTTONS = [
  { label: "พื้นที่ว่างตอนนี้", path: "", bounds: { x: 0, y: 0, width: 1225, height: 1686 } },
  { label: "จุดที่จอดรถไว้", path: "/parked", bounds: { x: 1225, y: 0, width: 625, height: 843 } },
  { label: "ลานจอดใกล้ฉัน", path: "/nearby", bounds: { x: 1850, y: 0, width: 650, height: 843 } },
  { label: "วิธีใช้งาน", path: "/help", bounds: { x: 1225, y: 843, width: 625, height: 843 } },
  { label: "ตั้งค่า", path: "/settings", bounds: { x: 1850, y: 843, width: 650, height: 843 } },
] as const;

const LIFF_ID = /^\d+-[A-Za-z0-9]+$/;

export function parseLiffId(value: string | undefined): string {
  const liffId = value?.trim() ?? "";
  if (!LIFF_ID.test(liffId)) {
    throw new Error("PRODUCTION_LIFF_ID must be a LIFF ID like 1234567890-AbCdEfGh");
  }
  return liffId;
}

export function liffUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}`;
}

export function richMenu(liffId: string): messagingApi.RichMenuRequest {
  return {
    size: { ...MENU_SIZE },
    selected: true,
    name: "ParkMap main menu",
    chatBarText: "เมนู ParkMap",
    areas: BUTTONS.map(({ label, path, bounds }) => ({
      bounds: { ...bounds },
      action: { type: "uri", label, uri: `${liffUrl(liffId)}${path}` },
    })),
  };
}
